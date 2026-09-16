// AUTO-GENERATED-STYLE shared helper, but hand-written (not synced from packages/domain — this is
// Edge-Function-specific, not portable domain logic).
//
// import-worker must only ever run as a trusted caller (pg_cron, or import-start's own
// fire-and-forget kick), never a regular signed-in user calling it directly with their own JWT.
// Default JWT verification (the platform-level check Supabase does before invoking the function
// at all) only proves the token is *some* valid Supabase JWT — an authenticated brand owner's own
// JWT passes that check too. This decodes the JWT's own `role` claim and requires it to be
// exactly `service_role`, which only the service-role key produces.
export function requireServiceRole(req: Request): Response | null {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) {
    return new Response(JSON.stringify({ error: "missing or malformed Authorization header" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.role !== "service_role") {
      return new Response(JSON.stringify({ error: "service-role access required" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "malformed JWT" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null; // ok — caller may proceed
}
