// Phase 5: creates the import_runs row for a file the browser has already uploaded to the
// private `imports` Storage bucket, then kicks the worker immediately so progress starts without
// waiting for the next pg_cron tick. The owner check here is the real gate — see the comment on
// the membership query below for why it's safe to trust despite running with the caller's own
// (lower-privilege) session rather than the service-role key.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

interface StartBody {
  brandId: string;
  kind: "contacts" | "campaigns";
  filename: string;
  storagePath: string;
}

function isValidBody(b: unknown): b is StartBody {
  if (typeof b !== "object" || b === null) return false;
  const r = b as Record<string, unknown>;
  return (
    typeof r.brandId === "string" &&
    (r.kind === "contacts" || r.kind === "campaigns") &&
    typeof r.filename === "string" &&
    typeof r.storagePath === "string" &&
    r.storagePath.startsWith(`${r.brandId}/`) // the storage RLS policy already enforces this at
    // upload time (storage.foldername(name)[1] must be a brand the uploader owns) — checked again
    // here so a mismatched brandId/storagePath pair is rejected with a clear error rather than
    // silently creating an import_runs row that points at a path nothing actually uploaded to.
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller-scoped client (anon key + their own JWT forwarded) — used only to establish who they
  // are and let RLS itself answer "are they an owner of this brand", never to write anything.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "not authenticated" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!isValidBody(body)) return json({ error: "invalid request body" }, 400);

  // The actual authorization check: RLS on memberships already scopes every row to
  // `user_id = auth.uid()` (supabase/migrations/0003_rls_policies.sql), so this query can only
  // ever return the CALLER's own membership — there is no way to pass someone else's brandId and
  // have this accidentally return true, regardless of what the client claims. filtering by
  // role='owner' server-side (via RLS-scoped data, not a client-asserted flag) is what actually
  // stops an analyst from starting an import.
  const { data: membership } = await callerClient
    .from("memberships")
    .select("role")
    .eq("brand_id", body.brandId)
    .eq("role", "owner")
    .maybeSingle();
  if (!membership) return json({ error: "owner access required for this brand" }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: run, error: insertErr } = await admin
    .from("import_runs")
    .insert({
      brand_id: body.brandId,
      kind: body.kind,
      filename: body.filename,
      storage_path: body.storagePath,
      status: "queued",
      created_by: userData.user.id,
    })
    .select()
    .single();
  if (insertErr) return json({ error: insertErr.message }, 500);

  // Best-effort immediate kick — pg_cron is the actual guarantee this keeps going (every 10s
  // while anything is queued/running), not this fetch. A failure here (network blip, cold start)
  // just means the user sees progress start on the next tick instead of instantly.
  fetch(`${supabaseUrl}/functions/v1/import-worker`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify({ importRunId: run.id }),
  }).catch(() => {});

  return json({ importRunId: run.id });
});
