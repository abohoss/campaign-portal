/**
 * tests/integration/metrics.test.ts
 *
 * Real reads against the real cloud Supabase project, with the real anon key and the real data
 * loaded in Phase 5 — no mocks, per docs/IMPLEMENTATION_PLAN.md §7.1. Deliberately READ-ONLY: this
 * signs in and calls the dashboard_* RPCs, never inserts/updates/deletes (same standing decision
 * as tests/integration/auth.test.ts).
 *
 * Skips entirely (not a failure) when docs/CREDENTIALS.local.json doesn't exist, same as
 * auth.test.ts — a fresh CI checkout never has it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { isContactable } from "@campaign-portal/domain";

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

describe.skipIf(!hasCredentials)("dashboard/contacts metrics against the live project (read-only)", () => {
  let SUPABASE_URL: string;
  let SUPABASE_ANON_KEY: string;
  let credentials: CredentialEntry[];

  beforeAll(() => {
    const env = loadEnvLocal();
    SUPABASE_URL = env.SUPABASE_URL!;
    SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY!;
    credentials = JSON.parse(readFileSync(CREDENTIALS_JSON_PATH, "utf-8")) as CredentialEntry[];
  });

  async function signIn(cred: CredentialEntry): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email: cred.email, password: cred.password });
    expect(error, `sign-in failed for ${cred.email}: ${error?.message}`).toBeNull();
    return client;
  }

  it("AC-NUM-01..06: dashboard_totals is internally consistent for every brand (contactable <= total)", async () => {
    for (const cred of credentials) {
      const client = await signIn(cred);
      // The RPC takes p_brand_id explicitly — resolve the caller's own brand id via their
      // membership row first (RLS-scoped, so this can only ever resolve to their own brand).
      const { data: membership } = await client.from("memberships").select("brand_id").single();
      const brandId = (membership as { brand_id: string }).brand_id;

      const { data: totals, error: totalsError } = await client
        .rpc("dashboard_totals", { p_brand_id: brandId })
        .single();
      expect(totalsError, `${cred.email}: dashboard_totals`).toBeNull();
      const t = totals as { total_customers: number; contactable: number };
      expect(t.total_customers).toBeGreaterThanOrEqual(0);
      expect(t.contactable).toBeGreaterThanOrEqual(0);
      expect(t.contactable, `${cred.email}: contactable must never exceed total_customers`).toBeLessThanOrEqual(
        t.total_customers,
      );
    }
  }, 30_000);

  it("AC-NUM-07/08: dashboard_signups_daily returns exactly 30 zero-filled, timezone-bucketed rows", async () => {
    const cred = credentials[0]!;
    const client = await signIn(cred);
    const { data: membership } = await client.from("memberships").select("brand_id").single();
    const brandId = (membership as { brand_id: string }).brand_id;

    const { data, error } = await client.rpc("dashboard_signups_daily", { p_brand_id: brandId });
    expect(error, `${cred.email}: dashboard_signups_daily`).toBeNull();
    expect(data).toHaveLength(30);
    for (const row of data as { day: string; signups: number }[]) {
      expect(row.signups).toBeGreaterThanOrEqual(0);
    }
  });

  it("AC-NUM-09: real Kilele data-quality finding — exactly 6 campaigns report more opens than deliveries", async () => {
    const kileleCred = credentials.find((c) => c.brand === "kilele");
    if (!kileleCred) return; // skip gracefully if this brand's account isn't provisioned yet
    const client = await signIn(kileleCred);
    const { data: membership } = await client.from("memberships").select("brand_id").single();
    const brandId = (membership as { brand_id: string }).brand_id;

    const { data, error } = await client.rpc("dashboard_campaign_performance", { p_brand_id: brandId });
    expect(error, `${kileleCred.email}: dashboard_campaign_performance`).toBeNull();
    const rows = data as { opens_exceed_delivered: boolean; reported_totals_inconsistent: boolean }[];
    expect(rows.filter((r) => r.opens_exceed_delivered)).toHaveLength(6);
    expect(rows.filter((r) => r.reported_totals_inconsistent)).toHaveLength(4);
    // Aggregating Kilele's 312k-row engagement_events, grouped by campaign_id and joined against
    // all 44 campaigns, legitimately exceeds Vitest's 5s default against the live project.
  }, 15_000);

  it("metrics.contactable.prop against real data: contacts_page's own-brand rows match isContactable's own count (Marrakech, smallest brand)", async () => {
    const cred = credentials.find((c) => c.brand === "marrakech");
    if (!cred) return;
    const client = await signIn(cred);
    const { data: membership } = await client.from("memberships").select("brand_id").single();
    const brandId = (membership as { brand_id: string }).brand_id;

    // Page through every real contact for this brand via the same RPC the app uses.
    const all: {
      deleted_at: string | null;
      consent_marketing: boolean | null;
      status: "active" | "pending" | "unsubscribed" | "bounced";
      email: string | null;
      email_valid: boolean;
      suppressed_until: string | null;
      created_at: string;
      id: string;
    }[] = [];
    let cursor: { created_at: string; id: string } | null = null;
    for (;;) {
      const { data: page, error } = await client.rpc("contacts_page", {
        p_brand_id: brandId,
        p_limit: 200,
        p_after_created_at: cursor?.created_at ?? null,
        p_after_id: cursor?.id ?? null,
      });
      expect(error, `${cred.email}: contacts_page`).toBeNull();
      const rows = page as typeof all;
      all.push(...rows);
      if (rows.length < 200) break;
      const last = rows[rows.length - 1]!;
      cursor = { created_at: last.created_at, id: last.id };
    }

    const referenceContactable = all.filter((c) =>
      isContactable({
        deletedAt: c.deleted_at,
        consentMarketing: c.consent_marketing,
        status: c.status,
        email: c.email,
        emailValid: c.email_valid,
        suppressedUntil: c.suppressed_until,
      }),
    ).length;

    const { data: totals, error: totalsError } = await client
      .rpc("dashboard_totals", { p_brand_id: brandId })
      .single();
    expect(totalsError, `${cred.email}: dashboard_totals`).toBeNull();
    const t = totals as { total_customers: number; contactable: number };

    expect(all).toHaveLength(t.total_customers);
    expect(referenceContactable).toBe(t.contactable);
  }, 30_000);
});
