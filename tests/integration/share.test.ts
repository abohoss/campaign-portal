/**
 * tests/integration/share.test.ts
 *
 * Real calls against the real cloud Supabase project and the real deployed share-view Edge
 * Function — no mocks. Scoped writes only: create_share_link/revoke_share_link touch
 * share_links/share_link_attempts alone (new, feature-specific tables — same scope already
 * approved for Phase 7's send tests), never contacts/campaigns/engagement_events. Every created
 * link is revoked and its rows removed via the service-role client in afterAll.
 *
 * Skips entirely (not a failure) when docs/CREDENTIALS.local.json doesn't exist, same as the other
 * integration suites.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const CREDENTIALS_JSON_PATH = join(REPO_ROOT, "docs", "CREDENTIALS.local.json");
const ENV_LOCAL_PATH = join(REPO_ROOT, ".env.local");

interface CredentialEntry {
  email: string;
  password: string;
  brand: string;
  role: string;
}

function loadEnvLocal(): Record<string, string> {
  const text = readFileSync(ENV_LOCAL_PATH, "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

const hasCredentials = existsSync(CREDENTIALS_JSON_PATH) && existsSync(ENV_LOCAL_PATH);

describe.skipIf(!hasCredentials)("share link against the live project (scoped writes)", () => {
  let SUPABASE_URL: string;
  let SUPABASE_ANON_KEY: string;
  let admin: SupabaseClient;
  let ownerCred: CredentialEntry;
  const createdLinkIds: string[] = [];

  beforeAll(() => {
    const env = loadEnvLocal();
    SUPABASE_URL = env.SUPABASE_URL!;
    SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY!;
    admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!);
    const credentials = JSON.parse(readFileSync(CREDENTIALS_JSON_PATH, "utf-8")) as CredentialEntry[];
    ownerCred = credentials.find((c) => c.role === "owner")!;
  });

  afterAll(async () => {
    if (createdLinkIds.length === 0) return;
    await admin.from("share_links").delete().in("id", createdLinkIds);
  });

  async function signIn(cred: CredentialEntry): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email: cred.email, password: cred.password });
    expect(error, `sign-in failed for ${cred.email}: ${error?.message}`).toBeNull();
    return client;
  }

  it("AC-SHARE-01: anon has no SELECT on share_links at all", async () => {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.from("share_links").select("*");
    expect(data === null || data.length === 0, "anon should never see any share_links row").toBe(true);
    void error;
  });

  it("creates a real share link, views it with the real password, and rejects a wrong one — via the real deployed Edge Function", async () => {
    const owner = await signIn(ownerCred);
    const { data: membership } = await owner.from("memberships").select("brand_id").eq("role", "owner").single();
    const { data: campaign } = await owner
      .from("campaigns")
      .select("id, name")
      .eq("brand_id", (membership as { brand_id: string }).brand_id)
      .limit(1)
      .single();

    const { data: token, error: createError } = await owner.rpc("create_share_link", {
      p_campaign_id: campaign!.id,
      p_password: "a-real-eval-password-1",
    });
    expect(createError).toBeNull();
    expect(typeof token).toBe("string");

    const { data: linkRow } = await admin
      .from("share_links")
      .select("id")
      .eq("campaign_id", campaign!.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    createdLinkIds.push(linkRow!.id as string);

    const correctRes = await fetch(`${SUPABASE_URL}/functions/v1/share-view`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ token, password: "a-real-eval-password-1" }),
    });
    expect(correctRes.status).toBe(200);
    const correctBody = (await correctRes.json()) as { campaignName: string };
    expect(correctBody.campaignName).toBe(campaign!.name);
    // No PII in the response shape at all.
    const serialised = JSON.stringify(correctBody);
    expect(serialised).not.toMatch(/@vg-eval\.test/);

    const wrongPasswordRes = await fetch(`${SUPABASE_URL}/functions/v1/share-view`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ token, password: "not-the-real-password" }),
    });
    const wrongTokenRes = await fetch(`${SUPABASE_URL}/functions/v1/share-view`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ token: "totally-bogus-token-shape", password: "a-real-eval-password-1" }),
    });
    // AC-SHARE-03: byte-identical status and body for both failure modes.
    expect(wrongPasswordRes.status).toBe(wrongTokenRes.status);
    expect(await wrongPasswordRes.json()).toEqual(await wrongTokenRes.json());
  }, 20_000);

  it("AC-SHARE-06: a revoked link fails even with the correct password", async () => {
    const owner = await signIn(ownerCred);
    const { data: membership } = await owner.from("memberships").select("brand_id").eq("role", "owner").single();
    const { data: campaigns } = await owner
      .from("campaigns")
      .select("id")
      .eq("brand_id", (membership as { brand_id: string }).brand_id)
      .limit(2);
    const campaign = campaigns![1] ?? campaigns![0]!;

    const { data: token } = await owner
      .rpc("create_share_link", { p_campaign_id: campaign.id, p_password: "a-real-eval-password-2" })
      .single();
    const { data: linkRow } = await admin
      .from("share_links")
      .select("id")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    createdLinkIds.push(linkRow!.id as string);

    const { error: revokeError } = await owner.rpc("revoke_share_link", { p_id: linkRow!.id });
    expect(revokeError).toBeNull();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/share-view`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ token, password: "a-real-eval-password-2" }),
    });
    expect(res.status).toBe(401);
  }, 20_000);
});
