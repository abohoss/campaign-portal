/**
 * scripts/verify-rls.ts
 *
 * Read-only, on-demand structural proof that RLS is enabled, forced, and actually delegates to
 * public.authorize() on every tenant table — run against the REAL linked Supabase cloud project
 * via the Management API (`supabase db query --linked`), never against a local/throwaway copy.
 *
 * This deliberately does not write anything. It replaced an earlier design (a Vitest integration
 * test that created throwaway auth users and fixture rows to prove cross-brand isolation
 * behaviourally) after a decision to never let automated tests mutate the actual project — see
 * the "Testing strategy — deviation" note in docs/IMPLEMENTATION_PLAN.md §7.1. Full behavioural
 * isolation proof (a real signed-in user reading zero rows from another brand) is deferred to
 * Phase 4+, tested against the deployed app's actual behaviour with the real six accounts, not
 * synthetic fixtures planted by a test run.
 *
 * NOT part of `npm run gate` — it needs network access and an authenticated `supabase` CLI
 * session (SUPABASE_ACCESS_TOKEN), which isn't assumed to be present in every environment. Run it
 * manually after any migration that touches RLS:
 *
 *   npm run verify:rls
 *
 * (PowerShell on this machine: the access token lives in a User-scope registry env var that a
 * pre-existing shell won't see — export it into $env: first, e.g.
 *   $env:SUPABASE_ACCESS_TOKEN = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN","User")
 * before running `npm run verify:rls`.)
 *
 * Two plain SELECTs, not one query with LIKE '%...%' + correlated subqueries: the CLI's transport
 * to the Management API silently mangled that shape into an empty row (`%` appears to collide with
 * something in the request encoding). The "does this policy call authorize()" substring check is
 * done here in JS instead, against the raw policy definitions from the second query.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TABLES_QUERY = `
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
`.trim();

const POLICIES_QUERY = `
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
`.trim();

interface TableRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
}

// Tables whose SELECT policy is intentionally NOT `authorize(...)`-based, and why. Anything not
// listed here is expected to call authorize() — see docs/IMPLEMENTATION_PLAN.md §5.2-§5.4.
const AUTHORIZE_EXCEPTIONS: Record<string, string> = {
  memberships:
    "scoped directly by `user_id = auth.uid()` — using authorize() here would be circular, " +
    "since authorize() itself queries memberships",
};

function queryLinked<T>(sql: string): T[] {
  // Written to a temp file and run with --file rather than passed inline: on Windows,
  // execFileSync's shell wrapping (needed to resolve `npx`) re-tokenises a multi-line/multi-space
  // SQL string into separate positional CLI arguments, which the supabase CLI then rejects.
  // A file path is one token — no quoting ambiguity possible.
  const dir = mkdtempSync(join(tmpdir(), "verify-rls-"));
  const sqlPath = join(dir, "query.sql");
  writeFileSync(sqlPath, sql, "utf-8");

  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", sqlPath], {
      encoding: "utf-8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"], // drop stderr — the CLI's "Initialising login role..."
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    console.error(e.stdout ?? "");
    console.error(e.stderr ?? e.message);
    throw new Error(
      "Could not query the linked project. Is SUPABASE_ACCESS_TOKEN set in THIS process's " +
        "environment, and has `supabase link` been run? See this script's header comment.",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) throw new Error(`No JSON object found in supabase CLI output:\n${raw}`);
  const parsed = JSON.parse(raw.slice(jsonStart)) as { rows: T[] };
  return parsed.rows;
}

function main(): void {
  const tables = queryLinked<TableRow>(TABLES_QUERY);
  const policies = queryLinked<PolicyRow>(POLICIES_QUERY);

  console.log(`\nChecked ${tables.length} table(s) in public schema on the linked project:\n`);

  let ok = true;
  const notEnabled: string[] = [];
  const notForced: string[] = [];
  const brokenAuthorize: string[] = [];

  for (const t of tables) {
    const exceptionReason = AUTHORIZE_EXCEPTIONS[t.table_name];
    const tablePolicies = policies.filter((p) => p.tablename === t.table_name);
    const selectPolicies = tablePolicies.filter((p) => p.cmd === "SELECT" || p.cmd === "ALL");
    const allSelectCallAuthorize =
      selectPolicies.length === 0 ? null : selectPolicies.every((p) => (p.qual ?? "").includes("authorize("));

    let authorizeLabel: string;
    if (exceptionReason) {
      authorizeLabel = `documented exception: ${exceptionReason}`;
    } else if (allSelectCallAuthorize === null) {
      authorizeLabel = "no SELECT policy";
    } else if (allSelectCallAuthorize) {
      authorizeLabel = "calls authorize()✓";
    } else {
      authorizeLabel = "does NOT call authorize()✗";
    }

    const flags = [
      t.rls_enabled ? "RLS✓" : "RLS✗",
      t.rls_forced ? "FORCED✓" : "FORCED✗",
      `${tablePolicies.length} polic${tablePolicies.length === 1 ? "y" : "ies"}`,
      authorizeLabel,
    ].join("  ");
    console.log(`  ${t.table_name.padEnd(22)} ${flags}`);

    if (!t.rls_enabled) notEnabled.push(t.table_name);
    if (!t.rls_forced) notForced.push(t.table_name);
    if (!exceptionReason && allSelectCallAuthorize === false) brokenAuthorize.push(t.table_name);
  }

  if (notEnabled.length > 0) {
    console.error(`\n✗ RLS NOT ENABLED: ${notEnabled.join(", ")}`);
    ok = false;
  }
  if (notForced.length > 0) {
    console.error(`✗ RLS NOT FORCED: ${notForced.join(", ")}`);
    ok = false;
  }
  if (brokenAuthorize.length > 0) {
    console.error(`✗ SELECT policy does not call authorize(): ${brokenAuthorize.join(", ")}`);
    ok = false;
  }

  if (ok) {
    console.log("\nAll tables: RLS enabled, forced, and every SELECT policy calls authorize(). ✅");
  } else {
    process.exitCode = 1;
  }
}

main();
