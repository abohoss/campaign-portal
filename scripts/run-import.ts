/**
 * scripts/run-import.ts
 *
 * Drives a real import end to end against the live project: uploads the file to the `imports`
 * Storage bucket, signs in as the brand's real owner (proving the owner-only RLS/Edge Function
 * gate the same way the deployed UI eventually will), calls import-start, then polls
 * import_runs — re-invoking import-worker directly if pg_cron hasn't picked it up yet by the
 * time this script would otherwise give up, so this works standalone before pg_cron scheduling
 * exists.
 *
 * This is the actual, intended way the seed data becomes each brand's real contacts/campaigns —
 * not a throwaway test. Re-running it against the same file is safe and idempotent (that's the
 * whole point of AC-IMP-09): it uploads under a fresh path each time but the upsert keys on
 * (brand_id, external_id), so re-importing the same file leaves the same row count.
 *
 * Usage:
 *   npx tsx scripts/run-import.ts <brandSlug> <contacts|campaigns> <path/to/file.csv> <ownerEmail>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function loadEnvLocal(): Record<string, string> {
  const text = readFileSync(".env.local", "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

interface CredentialEntry {
  email: string;
  password: string;
  brand: string;
  role: string;
}

async function main(): Promise<void> {
  const [brandSlug, kind, filePath, ownerEmail] = process.argv.slice(2);
  if (!brandSlug || !kind || !filePath || !ownerEmail || !["contacts", "campaigns"].includes(kind)) {
    console.error("Usage: run-import.ts <brandSlug> <contacts|campaigns> <path/to/file.csv> <ownerEmail>");
    process.exit(1);
  }

  const env = loadEnvLocal();
  const credentials: CredentialEntry[] = JSON.parse(readFileSync("docs/CREDENTIALS.local.json", "utf-8"));
  const cred = credentials.find((c) => c.email === ownerEmail);
  if (!cred) throw new Error(`No stored credentials for ${ownerEmail} — check docs/CREDENTIALS.local.json`);

  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: brand } = await admin.from("brands").select("id").eq("slug", brandSlug).single();
  if (!brand) throw new Error(`Brand '${brandSlug}' not found`);

  const owner = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
  const { error: signInError } = await owner.auth.signInWithPassword({ email: cred.email, password: cred.password });
  if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);
  const { data: sessionData } = await owner.auth.getSession();
  const accessToken = sessionData.session!.access_token;

  const filename = basename(filePath);
  const storagePath = `${brand.id}/${Date.now()}-${filename}`;
  const fileBuf = readFileSync(filePath);
  console.log(`Uploading ${filename} (${fileBuf.length.toLocaleString()} bytes) to ${storagePath}...`);
  const { error: uploadError } = await owner.storage.from("imports").upload(storagePath, fileBuf, {
    contentType: "text/csv",
  });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  console.log("Calling import-start...");
  const startRes = await fetch(`${env.SUPABASE_URL}/functions/v1/import-start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ brandId: brand.id, kind, filename, storagePath }),
  });
  const startBody = (await startRes.json()) as { importRunId?: string; error?: string };
  if (!startRes.ok) throw new Error(`import-start failed: ${JSON.stringify(startBody)}`);
  const importRunId = startBody.importRunId!;
  console.log(`import_run created: ${importRunId}`);

  // Poll, re-kicking the worker directly if it hasn't progressed — stands in for pg_cron, which
  // isn't guaranteed to have ticked yet on a run started seconds ago.
  const deadline = Date.now() + 5 * 60_000;
  let lastCursor = -1;
  let stableCount = 0;
  while (Date.now() < deadline) {
    const { data: run } = await admin.from("import_runs").select("*").eq("id", importRunId).single();
    console.log(
      `  status=${run!.status} chunk_cursor=${run!.chunk_cursor} processed=${run!.processed_rows}/${run!.total_rows ?? "?"} inserted=${run!.inserted_count} updated=${run!.updated_count} rejected=${run!.rejected_count} warnings=${run!.warning_count}`,
    );
    if (run!.status === "succeeded" || run!.status === "failed") {
      console.log(`\nFinished: ${run!.status}`);
      if (run!.error_summary) console.error(`error_summary: ${run!.error_summary}`);
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    if (run!.chunk_cursor === lastCursor) {
      stableCount++;
      if (stableCount >= 2) {
        // Not progressing — kick the worker directly rather than wait for pg_cron.
        console.log("  (no progress — invoking import-worker directly)");
        await fetch(`${env.SUPABASE_URL}/functions/v1/import-worker`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ importRunId }),
        });
        stableCount = 0;
      }
    } else {
      stableCount = 0;
    }
    lastCursor = run!.chunk_cursor;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for import to finish");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
