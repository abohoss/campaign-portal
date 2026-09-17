// Phase 9 (docs/IMPLEMENTATION_PLAN.md §5.8/§8 Phase 9): the only entry point a stranger with a
// share link ever hits. POST-only, token and password in the body — never a query string, so the
// token can't leak via referer or server logs. Every failure mode (wrong token, wrong password,
// revoked, rate limited) returns the exact same 401 body; public.share_view (0008_share.sql)
// already does the constant-shaped bcrypt work and identical-shape logging for every case, this
// function just forwards the result.
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

const INVALID_RESPONSE = { error: "invalid token or password" };

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function tokenToSha256Hex(token: string): Promise<string> {
  // create_share_link strips '=' padding when it mints the token (standard base64url), so it must
  // be restored here — atob() silently produces the wrong bytes for a non-multiple-of-4 length.
  // Sent to share_view as plain hex text, not a bytea literal — a raw `\x...` string doesn't
  // survive PostgREST's RPC parameter serialisation the way it would in a psql session (found via
  // an actual failing call through the deployed function); hex decoded server-side with
  // decode(..., 'hex') has one unambiguous representation over JSON.
  let std = token.replaceAll("-", "+").replaceAll("_", "/");
  while (std.length % 4 !== 0) std += "=";
  const bin = atob(std);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readCredentials(req: Request): Promise<{ token: string; password: string } | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  const { token, password } = (body ?? {}) as { token?: unknown; password?: unknown };
  if (typeof token !== "string" || typeof password !== "string" || !token || !password) return null;
  return { token, password };
}

function toShareResult(row: Record<string, unknown>) {
  return {
    campaignName: row.campaign_name,
    channel: row.channel,
    sentAt: row.sent_at,
    reportedSent: row.reported_sent,
    reportedDelivered: row.reported_delivered,
    reportedBounced: row.reported_bounced,
    reportedOpens: row.reported_opens,
    uniqueOpens: row.unique_opens,
    openRate: row.open_rate,
    bounceRate: row.bounce_rate,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(INVALID_RESPONSE, 405);

  const credentials = await readCredentials(req);
  if (!credentials) return json(INVALID_RESPONSE, 400);

  // A stranger's token is, by definition, untrusted input — atob() throws on a length that isn't
  // valid base64 (e.g. a garbage string whose length % 4 === 1, which needs an impossible 3
  // padding characters). That must fail exactly like a wrong token, never crash into a 500 that
  // would distinguish "malformed" from "well-formed but wrong" (AC-SHARE-03).
  let tokenHashHex: string;
  try {
    tokenHashHex = await tokenToSha256Hex(credentials.token);
  } catch {
    return json(INVALID_RESPONSE, 401);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = await sha256Hex(ip);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("share_view", {
    p_token_sha256_hex: tokenHashHex,
    p_password: credentials.password,
    p_ip_hash: ipHash,
  });

  if (error || !data || data.length === 0) return json(INVALID_RESPONSE, 401);
  return json(toShareResult(data[0]));
});
