/**
 * scripts/probe-provider.ts
 *
 * Phase 7, run BEFORE writing send-worker (docs/IMPLEMENTATION_PLAN.md §3.3). Answers the real
 * questions §3.2's contradiction table raises about the VG Messaging Dispatcher — since/next_cursor
 * semantics, idempotency-key behavior, recipient-key resolution, and whether `rejected[]` ever
 * populates — by actually calling it, not by re-reading its docs.
 *
 * Guard rails (all enforced in code, not just described): recipients are ALWAYS exactly
 * probe-1@vg-eval.test / probe-2@vg-eval.test; the script refuses to run if asked for more than 2;
 * every request/response is logged to docs/PROVIDER_PROBE.md with the API key redacted.
 *
 * Usage: npm run probe
 */
import { readFileSync, writeFileSync } from "node:fs";

const PROBE_RECIPIENTS = ["probe-1@vg-eval.test", "probe-2@vg-eval.test"] as const;
const MAX_RECIPIENTS = 2;

function loadEnvLocal(): Record<string, string> {
  const text = readFileSync(".env.local", "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

interface LogEntry {
  label: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  status: number | "error";
  responseBody: unknown;
}

const log: LogEntry[] = [];

function redact(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /authorization|api-key/i.test(k) ? "<redacted>" : v;
  }
  return out;
}

async function probe(
  label: string,
  method: string,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, { method, ...init });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => "<unreadable body>");
    }
    log.push({
      label,
      method,
      url,
      requestHeaders: init?.headers ? redact(init.headers as Record<string, string>) : undefined,
      requestBody: init?.body ? JSON.parse(init.body as string) : undefined,
      status: res.status,
      responseBody: body,
    });
    return { status: res.status, body };
  } catch (err) {
    log.push({
      label,
      method,
      url,
      requestHeaders: init?.headers ? redact(init.headers as Record<string, string>) : undefined,
      status: "error",
      responseBody: err instanceof Error ? err.message : String(err),
    });
    return { status: 0, body: null };
  }
}

function recipientObject(email: string, index: number): Record<string, string> {
  return { id: `probe-${index}`, external_id: `PROBE-${index}`, contact_id: `probe-${index}`, email };
}

async function main(): Promise<void> {
  if (PROBE_RECIPIENTS.length > MAX_RECIPIENTS) {
    throw new Error(`Refusing to run: ${PROBE_RECIPIENTS.length} recipients exceeds the hard cap of ${MAX_RECIPIENTS}.`);
  }

  const env = loadEnvLocal();
  const baseUrl = env.PROVIDER_BASE_URL!;
  const apiKey = env.PROVIDER_API_KEY!;
  const authHeaders = { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  // P1 — liveness, no auth.
  await probe("P1: GET /healthz (no auth)", "GET", `${baseUrl}/healthz`);

  // P2 — is auth actually enforced on /v1/docs?
  await probe("P2a: GET /v1/docs (no key)", "GET", `${baseUrl}/v1/docs`);
  await probe("P2b: GET /v1/docs (with key)", "GET", `${baseUrl}/v1/docs`, { headers: authHeaders });

  // P3 — one real batch, then poll its events three ways.
  const p3Body = JSON.stringify({ recipients: PROBE_RECIPIENTS.map(recipientObject) });
  const p3 = await probe("P3: POST /v1/messages (object recipients)", "POST", `${baseUrl}/v1/messages`, {
    headers: { ...authHeaders, "Idempotency-Key": "probe-p3" },
    body: p3Body,
  });
  const batchId = (p3.body as { batch_id?: string } | null)?.batch_id;
  if (batchId) {
    await probe("P3a: GET events, no since", "GET", `${baseUrl}/v1/messages/${batchId}/events`, {
      headers: authHeaders,
    });
    const firstEvents = (
      (await probe("P3b: GET events (fetch for first event_id)", "GET", `${baseUrl}/v1/messages/${batchId}/events`, {
        headers: authHeaders,
      })).body as { events?: { event_id?: string }[]; next_cursor?: string } | null
    );
    const firstEventId = firstEvents?.events?.[0]?.event_id;
    if (firstEventId) {
      await probe(
        `P3c: GET events, since=${firstEventId}`,
        "GET",
        `${baseUrl}/v1/messages/${batchId}/events?since=${encodeURIComponent(firstEventId)}`,
        { headers: authHeaders },
      );
    }
    if (firstEvents?.next_cursor) {
      await probe(
        "P3d: GET events, next_cursor from the first page",
        "GET",
        `${baseUrl}/v1/messages/${batchId}/events?since=${encodeURIComponent(firstEvents.next_cursor)}`,
        { headers: authHeaders },
      );
    }
  }

  // P4 — same Idempotency-Key, same body: does it dedupe?
  await probe("P4: POST /v1/messages again, SAME Idempotency-Key", "POST", `${baseUrl}/v1/messages`, {
    headers: { ...authHeaders, "Idempotency-Key": "probe-p3" },
    body: p3Body,
  });

  // P5 — different key, same body: confirms the key (not the body) drives dedup.
  await probe("P5: POST /v1/messages, SAME body, DIFFERENT Idempotency-Key", "POST", `${baseUrl}/v1/messages`, {
    headers: { ...authHeaders, "Idempotency-Key": "probe-p5" },
    body: p3Body,
  });

  // P6 — which recipient key field actually round-trips? Try bare strings vs each object shape.
  await probe("P6a: POST recipients as bare strings", "POST", `${baseUrl}/v1/messages`, {
    headers: { ...authHeaders, "Idempotency-Key": "probe-p6a" },
    body: JSON.stringify({ recipients: PROBE_RECIPIENTS }),
  });
  for (const field of ["id", "external_id", "contact_id", "recipient_id", "email"] as const) {
    await probe(`P6b: POST recipients keyed only on '${field}'`, "POST", `${baseUrl}/v1/messages`, {
      headers: { ...authHeaders, "Idempotency-Key": `probe-p6b-${field}` },
      body: JSON.stringify({
        recipients: PROBE_RECIPIENTS.map((email, i) => ({ [field]: field === "email" ? email : `probe-${i}` })),
      }),
    });
  }

  // P7 — a deliberately malformed recipient: does rejected[] ever populate?
  await probe("P7: POST with one malformed recipient (empty email)", "POST", `${baseUrl}/v1/messages`, {
    headers: { ...authHeaders, "Idempotency-Key": "probe-p7" },
    body: JSON.stringify({ recipients: [recipientObject(PROBE_RECIPIENTS[0], 0), { ...recipientObject("", 1) }] }),
  });

  // P8 — poll the same batch 3x over ~2 minutes, recording order/duplication.
  if (batchId) {
    for (let i = 0; i < 3; i++) {
      await probe(`P8: GET events, poll ${i + 1}/3`, "GET", `${baseUrl}/v1/messages/${batchId}/events`, {
        headers: authHeaders,
      });
      if (i < 2) await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  // P9 — error shapes: a non-existent batch, and a bad key.
  await probe(
    "P9a: GET events for a non-existent batch_id",
    "GET",
    `${baseUrl}/v1/messages/00000000-0000-0000-0000-000000000000/events`,
    { headers: authHeaders },
  );
  await probe("P9b: GET /v1/docs with a bad key", "GET", `${baseUrl}/v1/docs`, {
    headers: { Authorization: "Bearer not-a-real-key" },
  });

  const md = [
    "# Provider probe results",
    "",
    `Run at ${new Date().toISOString()} against \`${baseUrl}\`. API key redacted throughout.`,
    "Recipients used, every call: `probe-1@vg-eval.test`, `probe-2@vg-eval.test` (hard-capped in code).",
    "",
    ...log.map((e) =>
      [
        `## ${e.label}`,
        "",
        `\`${e.method} ${e.url}\``,
        e.requestHeaders ? `Request headers: \`${JSON.stringify(e.requestHeaders)}\`` : "",
        e.requestBody ? `Request body:\n\`\`\`json\n${JSON.stringify(e.requestBody, null, 2)}\n\`\`\`` : "",
        `Status: ${e.status}`,
        `Response:\n\`\`\`json\n${JSON.stringify(e.responseBody, null, 2)}\n\`\`\``,
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");

  writeFileSync("docs/PROVIDER_PROBE.md", md);
  console.log(`Wrote docs/PROVIDER_PROBE.md (${log.length} probes).`);
}

void main();
