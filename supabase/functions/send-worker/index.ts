// Phase 7 (docs/IMPLEMENTATION_PLAN.md §8 Phase 7): the chunked, resumable, idempotent send worker.
//
// Idempotency-Key is generated and persisted at preview_send time (send_chunks rows exist with
// their key from the moment a send is drafted, well before any HTTP call), and this worker always
// reuses that same key on every attempt of a given chunk — never a regenerated one. That's what
// makes retrying after a crash safe: per docs/PROVIDER_PROBE.md's C5 finding, the SAME key + body
// returns the SAME batch_id rather than sending twice, confirmed against the real provider, not
// assumed from its docs.
//
// A chunk whose HTTP call fails (network error, non-2xx) is left/reset to 'pending' with the error
// recorded, not marked permanently 'failed' — the idempotency key is the actual safety net, so the
// right response to a failure is "retry with the same key next tick", not "give up". 'failed' is
// reserved for logically impossible states (e.g. a chunk whose recipients vanished).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/service-role-guard.ts";

const DEADLINE_MS = 45_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface SendRow {
  id: string;
  brand_id: string;
  status: string;
  chunks_total: number;
  chunks_done: number;
}

interface ChunkRow {
  send_id: string;
  chunk_no: number;
  idempotency_key: string;
  state: string;
  attempts: number;
}

interface RecipientRow {
  id: string;
  external_id: string;
  email: string | null;
}

async function readTargetSendId(req: Request): Promise<string | undefined> {
  try {
    const body = await req.json();
    return typeof body?.sendId === "string" ? body.sendId : undefined;
  } catch {
    return undefined;
  }
}

async function findSend(admin: SupabaseClient, targetSendId: string | undefined): Promise<SendRow | null> {
  const query = targetSendId
    ? admin.from("sends").select("id, brand_id, status, chunks_total, chunks_done").eq("id", targetSendId)
    : admin
        .from("sends")
        .select("id, brand_id, status, chunks_total, chunks_done")
        .in("status", ["approved", "sending"])
        .order("approved_at", { ascending: true })
        .limit(1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data?.[0] as SendRow | undefined) ?? null;
}

async function nextPendingChunk(admin: SupabaseClient, sendId: string): Promise<ChunkRow | null> {
  const { data, error } = await admin
    .from("send_chunks")
    .select("send_id, chunk_no, idempotency_key, state, attempts")
    .eq("send_id", sendId)
    .in("state", ["pending", "in_flight"])
    .order("chunk_no", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as ChunkRow | undefined) ?? null;
}

function recipientPayload(r: RecipientRow) {
  // id wins when multiple keys are present (docs/PROVIDER_PROBE.md's C3 finding) — setting it to
  // our own send_recipients.id means an inbound event's recipient_id is directly our primary key,
  // no further resolution needed on ingest (Phase 8).
  return { id: r.id, external_id: r.external_id, contact_id: r.id, email: r.email ?? undefined };
}

interface ProviderResult {
  batchId: string | null;
  accepted: string[];
  rejected: { id?: string; reason?: string }[];
}

async function callProvider(chunk: ChunkRow, recipients: RecipientRow[]): Promise<ProviderResult> {
  const baseUrl = Deno.env.get("PROVIDER_BASE_URL")!;
  const apiKey = Deno.env.get("PROVIDER_API_KEY")!;
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "Idempotency-Key": chunk.idempotency_key,
    },
    body: JSON.stringify({ recipients: recipients.map(recipientPayload) }),
  });
  if (!res.ok) throw new Error(`provider returned ${res.status}: ${await res.text().catch(() => "")}`);
  const body = await res.json();
  return {
    batchId: typeof body?.batch_id === "string" ? body.batch_id : null,
    accepted: Array.isArray(body?.accepted) ? body.accepted : [],
    rejected: Array.isArray(body?.rejected) ? body.rejected : [],
  };
}

async function claimChunk(admin: SupabaseClient, chunk: ChunkRow): Promise<boolean> {
  const { data: claim } = await admin
    .from("send_chunks")
    .update({ state: "in_flight", attempts: chunk.attempts + 1, request_at: new Date().toISOString() })
    .eq("send_id", chunk.send_id)
    .eq("chunk_no", chunk.chunk_no)
    .eq("state", chunk.state) // compare-and-swap: only proceed if we're the one who claimed it
    .select("chunk_no");
  return !!claim && claim.length > 0;
}

async function markChunkFailed(admin: SupabaseClient, chunk: ChunkRow, message: string): Promise<void> {
  await admin
    .from("send_chunks")
    .update({ state: "failed", error: message, response_at: new Date().toISOString() })
    .eq("send_id", chunk.send_id)
    .eq("chunk_no", chunk.chunk_no);
}

async function resetChunkForRetry(admin: SupabaseClient, chunk: ChunkRow, message: string): Promise<void> {
  // 'pending' (not 'failed') — the idempotency key is unchanged, so the next tick's retry is safe
  // even if the provider actually processed this call before the error surfaced.
  await admin
    .from("send_chunks")
    .update({ state: "pending", error: message })
    .eq("send_id", chunk.send_id)
    .eq("chunk_no", chunk.chunk_no);
}

async function applyResultToRecipients(admin: SupabaseClient, chunk: ChunkRow, result: ProviderResult): Promise<void> {
  const rejectedIds = new Set(result.rejected.map((r) => r.id).filter((id): id is string => !!id));
  await admin
    .from("send_recipients")
    .update({ state: "sent", provider_message_id: result.batchId })
    .eq("send_id", chunk.send_id)
    .eq("chunk_no", chunk.chunk_no)
    .not("id", "in", `(${[...rejectedIds].map((id) => `"${id}"`).join(",") || "''"})`);
  for (const rejected of result.rejected) {
    if (!rejected.id) continue;
    await admin
      .from("send_recipients")
      .update({ state: "rejected", rejected_reason: rejected.reason ?? "rejected by provider" })
      .eq("id", rejected.id);
  }
}

async function markChunkDone(admin: SupabaseClient, chunk: ChunkRow, result: ProviderResult): Promise<void> {
  await admin
    .from("send_chunks")
    .update({
      state: "done",
      provider_batch_id: result.batchId,
      accepted_count: result.accepted.length,
      rejected_count: result.rejected.length,
      response_at: new Date().toISOString(),
    })
    .eq("send_id", chunk.send_id)
    .eq("chunk_no", chunk.chunk_no);
}

async function advanceSendProgress(
  admin: SupabaseClient,
  send: SendRow,
  chunk: ChunkRow,
  result: ProviderResult,
): Promise<void> {
  const providerBatchIds = result.batchId ? await appendBatchId(admin, send.id, result.batchId) : [];
  await admin
    .from("sends")
    .update({
      status: "sending",
      chunks_done: chunk.chunk_no + 1,
      ...(providerBatchIds.length > 0 ? { provider_batch_ids: providerBatchIds } : {}),
    })
    .eq("id", send.id);
}

async function processChunk(admin: SupabaseClient, send: SendRow, chunk: ChunkRow): Promise<void> {
  if (!(await claimChunk(admin, chunk))) return; // another concurrent invocation already claimed this chunk

  const { data: recipients, error: recipientsError } = await admin
    .from("send_recipients")
    .select("id, external_id, email")
    .eq("send_id", chunk.send_id)
    .eq("chunk_no", chunk.chunk_no);
  if (recipientsError) throw new Error(recipientsError.message);
  if (!recipients || recipients.length === 0) {
    await markChunkFailed(admin, chunk, "no recipients found for this chunk");
    return;
  }

  let result: ProviderResult;
  try {
    result = await callProvider(chunk, recipients as RecipientRow[]);
  } catch (err) {
    await resetChunkForRetry(admin, chunk, err instanceof Error ? err.message : String(err));
    return;
  }

  await applyResultToRecipients(admin, chunk, result);
  await markChunkDone(admin, chunk, result);
  await advanceSendProgress(admin, send, chunk, result);
}

async function appendBatchId(admin: SupabaseClient, sendId: string, batchId: string): Promise<string[]> {
  const { data } = await admin.from("sends").select("provider_batch_ids").eq("id", sendId).single();
  const existing: string[] = (data?.provider_batch_ids as string[] | undefined) ?? [];
  return existing.includes(batchId) ? existing : [...existing, batchId];
}

async function finalizeIfComplete(admin: SupabaseClient, sendId: string): Promise<boolean> {
  const { data: chunks, error } = await admin.from("send_chunks").select("state").eq("send_id", sendId);
  if (error) throw new Error(error.message);
  const allDone = (chunks ?? []).every((c) => c.state === "done");
  if (allDone) {
    await admin.from("sends").update({ status: "sent" }).eq("id", sendId);
  }
  return allDone;
}

Deno.serve(async (req) => {
  const guardResponse = requireServiceRole(req);
  if (guardResponse) return guardResponse;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const targetSendId = await readTargetSendId(req);

  let send: SendRow | null;
  try {
    send = await findSend(admin, targetSendId);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
  if (!send) return json({ processed: 0, message: "no sends ready to process" });
  if (send.status === "sent" || send.status === "failed" || send.status === "cancelled") {
    return json({ sendId: send.id, alreadyFinished: true, status: send.status });
  }

  const deadline = Date.now() + DEADLINE_MS;
  let chunksProcessed = 0;
  while (Date.now() < deadline) {
    const chunk = await nextPendingChunk(admin, send.id);
    if (!chunk) break;
    await processChunk(admin, send, chunk);
    chunksProcessed++;
  }

  const finished = await finalizeIfComplete(admin, send.id);
  return json({ sendId: send.id, chunksProcessedThisInvocation: chunksProcessed, finished });
});
