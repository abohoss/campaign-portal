/**
 * tests/integration/events.test.ts
 *
 * Real read-only check against the live project — no mocks, per docs/IMPLEMENTATION_PLAN.md §7.1.
 * ingest_provider_event and advance_events_cursor are granted to service_role only (never
 * authenticated) precisely because they skip the authorize() check every other SECURITY DEFINER
 * function in this build has — there is no signed-in caller to check against when the real caller
 * is sync-events running as service role. This proves that boundary holds: a real signed-in owner,
 * using the real anon key, cannot call either function at all. The convergence/sticky guarantees
 * themselves are proven without a database in packages/domain/src/events.test.ts.
 *
 * Skips entirely (not a failure) when docs/CREDENTIALS.local.json doesn't exist, same as the other
 * integration suites.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
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

describe.skipIf(!hasCredentials)("event ingest access boundary against the live project (read-only)", () => {
  let SUPABASE_URL: string;
  let SUPABASE_ANON_KEY: string;
  let cred: CredentialEntry;

  beforeAll(() => {
    const env = loadEnvLocal();
    SUPABASE_URL = env.SUPABASE_URL!;
    SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY!;
    const credentials = JSON.parse(readFileSync(CREDENTIALS_JSON_PATH, "utf-8")) as CredentialEntry[];
    cred = credentials.find((c) => c.role === "owner")!;
  });

  it("ingest_provider_event and advance_events_cursor are unreachable for a real signed-in owner (service_role only)", async () => {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({ email: cred.email, password: cred.password });
    expect(signInError).toBeNull();

    const { error: ingestError } = await client.rpc("ingest_provider_event", {
      p_send_id: "00000000-0000-0000-0000-000000000000",
      p_provider_event_id: "probe-access-check",
      p_recipient_id: "00000000-0000-0000-0000-000000000000",
      p_event_type: "delivered",
      p_occurred_at: new Date().toISOString(),
      p_payload: {},
    });
    expect(ingestError).not.toBeNull();

    const { error: cursorError } = await client.rpc("advance_events_cursor", {
      p_send_id: "00000000-0000-0000-0000-000000000000",
      p_batch_id: "probe-access-check",
      p_next_cursor: "x",
    });
    expect(cursorError).not.toBeNull();
  });
});
