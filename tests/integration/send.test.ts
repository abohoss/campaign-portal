/**
 * tests/integration/send.test.ts
 *
 * Real calls against the real cloud Supabase project, with the real anon key and the real
 * campaigns/contacts loaded in Phase 5 — no mocks. Unlike auth.test.ts and metrics.test.ts, this
 * file is NOT read-only: proving the send state machine's concurrency and validation guarantees
 * requires genuinely creating and confirming real `sends`/`send_recipients`/`send_chunks` rows —
 * there is no way to prove "exactly one of 20 concurrent confirms wins" by reading. This scope was
 * explicitly discussed and approved: writes are allowed to sends/send_recipients/send_chunks only,
 * never to contacts/campaigns/engagement_events. Every row this file creates is deleted via the
 * service-role client in an `afterAll`, cascading to send_recipients/send_chunks.
 *
 * Never invokes send-worker or the real provider — that would need the live VG Messaging
 * Dispatcher to actually accept a batch for real campaign contacts, which is a larger blast radius
 * than this test needs (confirm_send's guarantees are provable at the RPC/DB layer alone; the
 * worker's provider-calling path was already verified against the real provider by
 * docs/PROVIDER_PROBE.md's hard-capped probe).
 *
 * Skips entirely (not a failure) when docs/CREDENTIALS.local.json doesn't exist, same as the other
 * integration suites — a fresh CI checkout never has it.
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

describe.skipIf(!hasCredentials)("send state machine against the live project (scoped writes)", () => {
  let SUPABASE_URL: string;
  let SUPABASE_ANON_KEY: string;
  let admin: SupabaseClient;
  let ownerCred: CredentialEntry;
  let analystCred: CredentialEntry | undefined;
  const createdSendIds: string[] = [];

  beforeAll(async () => {
    const env = loadEnvLocal();
    SUPABASE_URL = env.SUPABASE_URL!;
    SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY!;
    admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!);
    const credentials = JSON.parse(readFileSync(CREDENTIALS_JSON_PATH, "utf-8")) as CredentialEntry[];
    const rolePairs = credentials
      .filter((c) => c.role === "owner")
      .map((owner) => ({ owner, analyst: credentials.find((c) => c.role === "analyst" && c.brand === owner.brand) }))
      .filter((pair): pair is { owner: CredentialEntry; analyst: CredentialEntry } => pair.analyst !== undefined);
    expect(rolePairs.length, "no brand has both an owner and analyst account").toBeGreaterThan(0);

    const { data: brands, error: brandsError } = await admin.from("brands").select("id, slug");
    expect(brandsError, "brand lookup").toBeNull();
    const brandIdBySlug = new Map((brands ?? []).map((brand) => [brand.slug as string, brand.id as string]));

    const contactCounts = await Promise.all(
      rolePairs.map(async (pair) => {
        const brandId = brandIdBySlug.get(pair.owner.brand);
        expect(brandId, `${pair.owner.brand}: brand lookup`).toBeDefined();
        const { count, error } = await admin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId!);
        expect(error, `${pair.owner.brand}: contact count`).toBeNull();
        return { pair, count: count ?? Number.MAX_SAFE_INTEGER };
      }),
    );
    contactCounts.sort((a, b) => a.count - b.count);
    ownerCred = contactCounts[0]!.pair.owner;
    analystCred = contactCounts[0]!.pair.analyst;
    expect(ownerCred, "docs/CREDENTIALS.local.json has no owner account — run scripts/provision-users.ts").toBeDefined();
  });

  afterAll(async () => {
    if (createdSendIds.length === 0) return;
    // Cascades to send_recipients and send_chunks (ON DELETE CASCADE) — leaves no test residue in
    // any of the three tables this file is scoped to write.
    await admin.from("sends").delete().in("id", createdSendIds);
  });

  async function signIn(cred: CredentialEntry): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email: cred.email, password: cred.password });
    expect(error, `sign-in failed for ${cred.email}: ${error?.message}`).toBeNull();
    return client;
  }

  async function previewFreshSend(owner: SupabaseClient): Promise<{ sendId: string; recipientCount: number }> {
    // Pick a campaign this brand owns that has no existing send yet, so preview_send creates a
    // genuinely new draft rather than reusing one a previous test run left behind.
    const { data: membership } = await owner.from("memberships").select("brand_id").eq("role", "owner").single();
    const brandId = (membership as { brand_id: string }).brand_id;
    const { data: campaigns } = await owner.from("campaigns").select("id").eq("brand_id", brandId).limit(25);
    const { data: existingSends } = await admin
      .from("sends")
      .select("campaign_id")
      .in("campaign_id", (campaigns ?? []).map((c) => c.id as string));
    const usedIds = new Set((existingSends ?? []).map((s) => s.campaign_id as string));
    const freeCampaign = (campaigns ?? []).find((c) => !usedIds.has(c.id as string));
    expect(freeCampaign, "every sampled campaign already has a send — widen the .limit(25) above").toBeDefined();

    const { data, error } = await owner.rpc("preview_send", { p_campaign_id: freeCampaign!.id }).single();
    expect(error, `preview_send: ${error?.message}`).toBeNull();
    const row = data as { send_id: string; recipient_count: number };
    createdSendIds.push(row.send_id);
    return { sendId: row.send_id, recipientCount: row.recipient_count };
  }

  it("AC-SEND-03: 20 concurrent confirm_send calls on one draft — exactly one succeeds", async () => {
    const owner = await signIn(ownerCred);
    const { sendId, recipientCount } = await previewFreshSend(owner);

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () => owner.rpc("confirm_send", { p_send_id: sendId, p_expected_count: recipientCount })),
    );
    const succeeded = attempts.filter(
      (r) => r.status === "fulfilled" && !(r.value as { error: unknown }).error,
    );
    expect(succeeded).toHaveLength(1);

    const { data: finalSend } = await admin.from("sends").select("status").eq("id", sendId).single();
    expect(finalSend?.status).toBe("approved");
  }, 60_000);

  it("AC-SEND-04: confirm_send rejects a stale expected count and leaves the send in draft", async () => {
    const owner = await signIn(ownerCred);
    const { sendId, recipientCount } = await previewFreshSend(owner);

    const { error } = await owner.rpc("confirm_send", { p_send_id: sendId, p_expected_count: recipientCount + 1 });
    expect(error?.message).toMatch(/count_changed/);

    const { data: send } = await admin.from("sends").select("status").eq("id", sendId).single();
    expect(send?.status).toBe("draft");
  }, 60_000);

  it("AC-SEND-05: an analyst's confirm_send is rejected server-side, even with the real expected count", async () => {
    if (!analystCred) return; // skip gracefully if this brand has no analyst account provisioned
    const owner = await signIn(ownerCred);
    const { sendId, recipientCount } = await previewFreshSend(owner);

    const analyst = await signIn(analystCred);
    const { error } = await analyst.rpc("confirm_send", { p_send_id: sendId, p_expected_count: recipientCount });
    expect(error?.message).toMatch(/owner/i);

    const { data: send } = await admin.from("sends").select("status").eq("id", sendId).single();
    expect(send?.status).toBe("draft");
  }, 60_000);

  it("preview_send is idempotent: calling it again for the same campaign returns the same draft, not a new one", async () => {
    const owner = await signIn(ownerCred);
    const first = await previewFreshSend(owner);
    const { data: send } = await admin.from("sends").select("campaign_id").eq("id", first.sendId).single();

    const { data, error } = await owner.rpc("preview_send", { p_campaign_id: send!.campaign_id }).single();
    expect(error).toBeNull();
    const second = data as { send_id: string; recipient_count: number };
    createdSendIds.push(second.send_id); // same id as first.sendId — harmless duplicate for cleanup's .in()

    expect(second.send_id).toBe(first.sendId);
    expect(second.recipient_count).toBe(first.recipientCount);
  }, 60_000);

  it("preview_send freezes a send_recipients row per contactable contact, matching the returned count exactly", async () => {
    const owner = await signIn(ownerCred);
    const { sendId, recipientCount } = await previewFreshSend(owner);

    const { count, error } = await admin
      .from("send_recipients")
      .select("id", { count: "exact", head: true })
      .eq("send_id", sendId);
    expect(error).toBeNull();
    expect(count).toBe(recipientCount);
  }, 60_000);
});
