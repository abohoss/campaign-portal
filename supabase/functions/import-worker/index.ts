// Phase 5 (docs/IMPLEMENTATION_PLAN.md §8 Phase 5): the chunked, resumable import worker.
//
// Design: re-parses the whole file on every invocation (parsing is deterministic and fast even
// at 84k rows — packages/domain's CSV parser is pure and pays no I/O cost beyond the one Storage
// download) rather than trying to persist parsed state between stateless invocations. What
// actually makes this resumable is that it only ever *applies* chunks starting at
// import_runs.chunk_cursor — chunks before that were already durably committed by
// apply_import_chunk (one chunk = one transaction: upsert + import_errors + counters +
// chunk_cursor advance, together), so re-parsing and re-walking the file is safe: chunks already
// committed are simply skipped, never resent.
//
// Triggered by: pg_cron every 10s while any run is queued/running (supabase/migrations —
// schedule set up via the dashboard/CLI, see docs/MANUAL_SETUP.md), and by import-start's
// fire-and-forget kick so the UI doesn't wait for the next tick. Requires the service-role key —
// see _shared/service-role-guard.ts for why a regular user's own JWT isn't accepted here even
// though it would pass the platform's default JWT check.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { validateCampaignsFile, validateContactsFile } from "../_shared/domain/index.ts";
import { requireServiceRole } from "../_shared/service-role-guard.ts";
import type { BrandSlug, ImportResult, NormalisedCampaign, NormalisedContact } from "../_shared/domain/index.ts";

const CHUNK_SIZE = 5000;
// Leaves real headroom under the platform's execution limit — sized to finish comfortably within
// a single invocation for every file in the seed (the largest, kilele-events.csv, isn't imported
// through this path at all; kilele-contacts.csv at 84k rows parses and chunks in low seconds).
const DEADLINE_MS = 45_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface ImportRunRow {
  id: string;
  brand_id: string;
  kind: "contacts" | "campaigns";
  storage_path: string;
  status: string;
  total_rows: number | null;
  chunk_cursor: number;
}

async function readTargetRunId(req: Request): Promise<string | undefined> {
  try {
    const body = await req.json();
    return typeof body?.importRunId === "string" ? body.importRunId : undefined;
  } catch {
    return undefined; // no/empty body — caller falls back to "pick up the oldest pending run"
  }
}

async function findRun(admin: SupabaseClient, targetRunId: string | undefined): Promise<ImportRunRow | null> {
  const query = targetRunId
    ? admin.from("import_runs").select("*").eq("id", targetRunId)
    : admin.from("import_runs").select("*").in("status", ["queued", "running"]).order("created_at", { ascending: true }).limit(1);
  const { data: runs, error } = await query;
  if (error) throw new Error(error.message);
  return (runs?.[0] as ImportRunRow | undefined) ?? null;
}

async function downloadAndValidate(
  admin: SupabaseClient,
  run: ImportRunRow,
): Promise<ImportResult<NormalisedContact> | ImportResult<NormalisedCampaign>> {
  const { data: fileBlob, error: dlErr } = await admin.storage.from("imports").download(run.storage_path);
  if (dlErr) throw new Error(`download failed: ${dlErr.message}`);
  const buf = new Uint8Array(await fileBlob.arrayBuffer());

  const { data: brand, error: brandErr } = await admin.from("brands").select("slug").eq("id", run.brand_id).single();
  if (brandErr || !brand) throw new Error(brandErr?.message ?? "brand not found");
  const brandSlug = brand.slug as BrandSlug;

  return run.kind === "contacts" ? validateContactsFile(buf, brandSlug) : validateCampaignsFile(buf, brandSlug);
}

async function recordTotalRowsOnce(
  admin: SupabaseClient,
  run: ImportRunRow,
  result: ImportResult<NormalisedContact> | ImportResult<NormalisedCampaign>,
): Promise<void> {
  if (run.total_rows !== null) return;
  await admin
    .from("import_runs")
    .update({
      total_rows: result.totalRows,
      detected_encoding: result.detectedEncoding,
      detected_delimiter: result.detectedDelimiter,
    })
    .eq("id", run.id)
    .is("total_rows", null); // guards against clobbering on a resumed/re-triggered invocation
}

interface ChunkLoopResult {
  cursor: number;
  totalChunks: number;
  lastCounts: unknown;
  failure: { chunkNo: number; message: string } | null;
}

async function runChunkLoop(
  admin: SupabaseClient,
  run: ImportRunRow,
  result: ImportResult<NormalisedContact> | ImportResult<NormalisedCampaign>,
): Promise<ChunkLoopResult> {
  const totalChunks = Math.max(1, Math.ceil(result.valid.length / CHUNK_SIZE));
  const deadline = Date.now() + DEADLINE_MS;

  let cursor = run.chunk_cursor;
  let lastCounts: unknown = null;
  while (cursor < totalChunks && Date.now() < deadline) {
    const rows = result.valid.slice(cursor * CHUNK_SIZE, (cursor + 1) * CHUNK_SIZE);
    // All issues travel with chunk 0 — cheap as a single bulk insert (even Kilele's 6,574 issues
    // serialise to under 2MB of JSON), and it means resuming from any chunk_cursor > 0 never
    // risks re-sending (and thus duplicating) import_errors rows for issues already recorded.
    const issues = cursor === 0 ? result.issues : [];
    const isLastChunk = cursor === totalChunks - 1;

    const { data: rpcData, error: rpcError } = await admin.rpc("apply_import_chunk", {
      p_import_run_id: run.id,
      p_chunk_no: cursor,
      p_rows: rows,
      p_issues: issues,
      p_is_last_chunk: isLastChunk,
    });
    if (rpcError) return { cursor, totalChunks, lastCounts, failure: { chunkNo: cursor, message: rpcError.message } };
    lastCounts = rpcData;
    cursor++;
  }
  return { cursor, totalChunks, lastCounts, failure: null };
}

Deno.serve(async (req) => {
  const guardResponse = requireServiceRole(req);
  if (guardResponse) return guardResponse;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const targetRunId = await readTargetRunId(req);

  let run: ImportRunRow | null;
  try {
    run = await findRun(admin, targetRunId);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
  if (!run) return json({ processed: 0, message: "no pending import runs" });
  if (run.status === "succeeded" || run.status === "failed") {
    return json({ importRunId: run.id, alreadyFinished: true, status: run.status });
  }

  let result: ImportResult<NormalisedContact> | ImportResult<NormalisedCampaign>;
  try {
    result = await downloadAndValidate(admin, run);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("import_runs").update({ status: "failed", error_summary: message }).eq("id", run.id);
    return json({ error: message }, 500);
  }

  await recordTotalRowsOnce(admin, run, result);

  const loopResult = await runChunkLoop(admin, run, result);
  if (loopResult.failure) {
    await admin.from("import_runs").update({ status: "failed", error_summary: loopResult.failure.message }).eq("id", run.id);
    return json({ error: loopResult.failure.message, chunkNo: loopResult.failure.chunkNo }, 500);
  }

  return json({
    importRunId: run.id,
    chunksProcessedThisInvocation: loopResult.cursor - run.chunk_cursor,
    totalChunks: loopResult.totalChunks,
    finished: loopResult.cursor >= loopResult.totalChunks,
    lastCounts: loopResult.lastCounts,
  });
});
