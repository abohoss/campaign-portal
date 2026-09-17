// Phase 8 (docs/IMPLEMENTATION_PLAN.md §8 Phase 8): polls the provider for delivery reports on
// every send that has actually dispatched something, and ingests them idempotently and
// order-independently (packages/domain/src/events.ts proves the convergence property this relies
// on; supabase/migrations/0007_events.sql's ingest_provider_event applies it per-event, one
// transaction each).
//
// Always pages with next_cursor, never since=<event_id> — docs/PROVIDER_PROBE.md's C2 finding
// proved the latter doesn't filter anything (it replays the same page). A send that dispatched
// across multiple chunks has one provider batch_id per chunk, each with its own cursor, tracked in
// sends.events_cursor as a { [batch_id]: cursor } map.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/service-role-guard.ts";

const DEADLINE_MS = 45_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface SendRow {
  id: string;
  provider_batch_ids: string[];
  events_cursor: Record<string, string> | null;
}

interface ProviderEvent {
  event_id: string;
  recipient_id: string;
  type: string;
  occurred_at: string;
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
    ? admin.from("sends").select("id, provider_batch_ids, events_cursor").eq("id", targetSendId)
    : admin
        .from("sends")
        .select("id, provider_batch_ids, events_cursor")
        .in("status", ["sending", "sent"])
        .not("provider_batch_ids", "eq", "{}")
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data?.[0] as SendRow | undefined) ?? null;
}

async function fetchEventsPage(
  batchId: string,
  cursor: string | undefined,
): Promise<{ events: ProviderEvent[]; nextCursor: string | null }> {
  const baseUrl = Deno.env.get("PROVIDER_BASE_URL")!;
  const apiKey = Deno.env.get("PROVIDER_API_KEY")!;
  const url = new URL(`${baseUrl}/v1/messages/${batchId}/events`);
  if (cursor) url.searchParams.set("since", cursor);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`provider returned ${res.status}: ${await res.text().catch(() => "")}`);
  const body = await res.json();
  return {
    events: Array.isArray(body?.events) ? body.events : [],
    nextCursor: typeof body?.next_cursor === "string" ? body.next_cursor : null,
  };
}

async function ingestOneBatch(admin: SupabaseClient, send: SendRow, batchId: string): Promise<number> {
  const cursor = send.events_cursor?.[batchId];
  const { events, nextCursor } = await fetchEventsPage(batchId, cursor);

  for (const event of events) {
    const { error } = await admin.rpc("ingest_provider_event", {
      p_send_id: send.id,
      p_provider_event_id: event.event_id,
      p_recipient_id: event.recipient_id,
      p_event_type: event.type,
      p_occurred_at: event.occurred_at,
      p_payload: event,
    });
    if (error) throw new Error(`ingest_provider_event(${event.event_id}): ${error.message}`);
  }

  if (nextCursor && nextCursor !== cursor) {
    const { error } = await admin.rpc("advance_events_cursor", {
      p_send_id: send.id,
      p_batch_id: batchId,
      p_next_cursor: nextCursor,
    });
    if (error) throw new Error(`advance_events_cursor: ${error.message}`);
  }

  return events.length;
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
  if (!send) return json({ processed: 0, message: "no sends ready to sync" });

  const deadline = Date.now() + DEADLINE_MS;
  let eventsIngested = 0;
  for (const batchId of send.provider_batch_ids) {
    if (Date.now() >= deadline) break;
    try {
      eventsIngested += await ingestOneBatch(admin, send, batchId);
    } catch (err) {
      return json({ sendId: send.id, batchId, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return json({ sendId: send.id, batches: send.provider_batch_ids.length, eventsIngested });
});
