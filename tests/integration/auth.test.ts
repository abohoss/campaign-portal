/**
 * tests/integration/auth.test.ts
 *
 * Real sign-ins against the real cloud Supabase project, with the real anon key — no mocks, per
 * docs/IMPLEMENTATION_PLAN.md §7.1. This is the behavioural half of Phase 3/4's isolation proof
 * (AC-ISO-02) that Phase 3 had to defer: it needed real accounts to sign in as, and now five of
 * the six exist (docs/MANUAL_SETUP.md).
 *
 * Deliberately READ-ONLY. Per the standing decision recorded in docs/IMPLEMENTATION_PLAN.md §7.1
 * ("Testing strategy — deviation"), no automated test writes to the real project. This test signs
 * in and reads; it never inserts, updates, or deletes, including write-*rejection* checks (which
 * would leave no residue even on success, but are left as a manual/Phase-6+ exercise rather than
 * unilaterally reinterpreting that decision here).
 *
 * Skips entirely (not a failure) when docs/CREDENTIALS.local.json doesn't exist — that file is
 * gitignored and only exists on a machine that has run scripts/provision-users.ts against the
 * real project, which a fresh CI checkout never has.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

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

describe.skipIf(!hasCredentials)("real sign-ins against the live project (read-only)", () => {
  let SUPABASE_URL: string;
  let SUPABASE_ANON_KEY: string;
  let credentials: CredentialEntry[];

  beforeAll(() => {
    const env = loadEnvLocal();
    SUPABASE_URL = env.SUPABASE_URL!;
    SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY!;
    credentials = JSON.parse(readFileSync(CREDENTIALS_JSON_PATH, "utf-8")) as CredentialEntry[];
    expect(credentials.length, "docs/CREDENTIALS.local.json is empty — run scripts/provision-users.ts").toBeGreaterThan(0);
  });

  async function signIn(cred: CredentialEntry): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: cred.email,
      password: cred.password,
    });
    expect(error, `sign-in failed for ${cred.email}: ${error?.message}`).toBeNull();
    return client;
  }

  it("AC-AUTH-01/02/03: each provisioned account signs in and sees exactly one brand", async () => {
    for (const cred of credentials) {
      const client = await signIn(cred);
      const { data, error } = await client.from("brands").select("slug");
      expect(error, `${cred.email}: brands query`).toBeNull();
      expect(data, `${cred.email} should see exactly their own brand`).toEqual([{ slug: cred.brand }]);
    }
  });

  it("AC-AUTH-01/02: each account's membership row matches its provisioned brand and role", async () => {
    for (const cred of credentials) {
      const client = await signIn(cred);
      const { data, error } = await client
        .from("memberships")
        .select("role, brands:brand_id(slug)");
      expect(error, `${cred.email}: memberships query`).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({ role: cred.role, brands: { slug: cred.brand } });
    }
  });

  it("AC-ISO-02: signing in as one brand's account reads zero rows tagged with another brand's id", async () => {
    const byBrand = new Map(credentials.map((c) => [c.brand, c] as const));
    // Only meaningful across at least two distinct brands — skip gracefully if we only have one.
    const brands = [...byBrand.keys()];
    if (brands.length < 2) return;

    const admin = createClient(SUPABASE_URL, loadEnvLocal().SUPABASE_SERVICE_ROLE_KEY!);
    const { data: allBrands } = await admin.from("brands").select("id, slug");
    const brandIdBySlug = new Map((allBrands ?? []).map((b) => [b.slug as string, b.id as string]));

    for (const cred of credentials) {
      const client = await signIn(cred);
      const ownBrandId = brandIdBySlug.get(cred.brand);
      for (const table of ["contacts", "campaigns", "engagement_events", "memberships"] as const) {
        const { data, error } = await client.from(table).select("brand_id");
        expect(error, `${cred.email}/${table}`).toBeNull();
        const foreign = (data ?? []).filter((r) => r.brand_id !== ownBrandId);
        expect(foreign, `${cred.email} saw a foreign brand_id in ${table}`).toEqual([]);
      }
    }
  });

  it("AC-ISO-06: the anon role (no session) reads zero rows from every protected table", async () => {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const table of ["contacts", "campaigns", "engagement_events", "brands", "memberships", "allowed_emails"] as const) {
      const { data, error } = await anon.from(table).select("*");
      if (error) continue; // a permission error is an acceptable form of "reads nothing"
      expect(data, `anon unexpectedly read rows from ${table}`).toEqual([]);
    }
  });

  it("AC-AUTH-08: a fresh sign-in produces a usable session (token present, matches the account)", async () => {
    const cred = credentials[0]!;
    const client = await signIn(cred);
    const { data, error } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.email?.toLowerCase()).toBe(cred.email.toLowerCase());
  });
});
