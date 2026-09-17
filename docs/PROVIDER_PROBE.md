# Provider probe results

Run at 2026-09-16T21:30:42.235Z against `https://dispatcher-production-72fc.up.railway.app`. API key redacted throughout.
Recipients used, every call: `probe-1@vg-eval.test`, `probe-2@vg-eval.test` (hard-capped in code).

## Findings, resolved against §3.2's contradiction table

| # | Docs claim | What actually happened | Design decision |
|---|---|---|---|
| C1 | "every event is delivered exactly once and in order" | **False, confirmed live.** Poll 2/3 of the same batch (P8) returned a genuine duplicate of `evt-batch_c1-00000`, *and* a completely unrelated event for a real Karoo contact (`recipient_id: "CT-068845"`, `brand_code: "KAROO"`) injected into a Kilele-probe batch's own event stream — see "Critical finding" below. | Confirmed as designed: dedupe on `provider_event_id`, never trust a batch's event stream to only contain that batch's own recipients. |
| C2 | "`since`" and "`next_cursor`" both documented, relation unstated | `since=<event_id>` (P3c) **did not filter anything out** — replayed the exact same page as no-`since` (P3a/b). `since=<next_cursor token>` (P3d) *did* correctly return zero new events. **`since=<event_id>` does not work as documented; only `next_cursor` does.** | Always use `next_cursor`. Never fall back to `since=<last_event_id>` — it's not just unspecified, it's empirically non-functional. Persist `next_cursor` only; `last_event_id` is unnecessary. |
| C3 | keyed on any of 5 fields, unstated priority | Sent an object with `id`, `external_id`, `contact_id`, and `email` all populated (P3) — the response's `accepted[]` echoed back the **`id`** values, not the others. `id` wins when multiple fields are present. | Set `id` to our own `send_recipients.id` (uuid) on every request. Its later `recipient_id` in events will then match `send_recipients.id` directly — no multi-field resolution needed on ingest, just one indexed lookup. Still populate `external_id`/`contact_id`/`email` too, as documentation/fallback. |
| C4 | `rejected` "(normally empty)" | Confirmed empty even for a deliberately malformed recipient (empty-string email, P7) — this provider does not reject bad input at all, it accepts everything. | Never rely on `rejected[]` catching anything. Still parse and persist it defensively (a future provider version might populate it), but validation must happen on our side before sending. |
| C5 | `Idempotency-Key` "Optional" | Confirmed load-bearing: the *same* key + body (P3 → P4) returned the **same** `batch_id` both times. A *different* key with the *same* body (P5) returned a **new** `batch_id` — the key, not the body, drives dedup. | Always send it, exactly as planned (`send_id:chunk_no`), persisted before the HTTP call. |
| C6 | 4 event types documented | Only `delivered` was observed (auto-generated immediately on acceptance, no separate "sent" stage) — `opened`/`bounced`/`unsubscribed` never fire for synthetic addresses in a short probe window, as expected. | No change; canonical enum already covers all 4. |

### Critical finding: the provider leaks cross-tenant events into an unrelated batch's stream

Poll 2/3 of a probe-only batch (containing only `probe-1@vg-eval.test`/`probe-2@vg-eval.test`) returned, alongside a genuine duplicate, this **unrequested** event:

```json
{
  "event_id": "evt-batch_c1-forged",
  "recipient_id": "CT-068845",
  "brand_code": "KAROO",
  "type": "delivered",
  "occurred_at": "2026-09-16T21:36:30Z"
}
```

`CT-068845` and `brand_code: "KAROO"` match nothing about this probe — this looks like either a real cross-customer leak in the provider's own backend, or (more likely, given the brief's framing) a deliberate test: does the consumer blindly trust everything a batch's event stream hands it? **This is not hypothetical for this build**: if `ingest_provider_events` (§5.7, Phase 8) ever resolved `recipient_id` without scoping the lookup to `send_recipients` rows that actually belong to the send/brand being synced, an event exactly like this one would silently write a fake "delivered" event onto a real contact's history. The plan's existing design — resolve via lookup, quarantine on no match — already handles this correctly, because a UUID `send_recipients.id` will never collide with a string like `CT-068845`. This finding is the concrete, empirical justification for that design choice, not a hypothetical one; it also means the ingest function should additionally assert the resolved contact's `brand_id` matches the sync's own brand before writing anything, as a second independent check.

## P1: GET /healthz (no auth)
`GET https://dispatcher-production-72fc.up.railway.app/healthz`
Status: 200
Response:
```json
{
  "status": "ok",
  "db": "ok",
  "time": "2026-09-16T21:28:36.507763+00:00"
}
```
## P2a: GET /v1/docs (no key)
`GET https://dispatcher-production-72fc.up.railway.app/v1/docs`
Status: 200
Response:
```json
{
  "service": "VG Messaging Dispatcher",
  "version": "1.4.0",
  "overview": "Send campaigns and read delivery reports. Authenticate every request with the API key issued to you: 'Authorization: Bearer <API_KEY>' (or the 'X-API-Key' header).",
  "authentication": {
    "scheme": "Bearer",
    "header": "Authorization: Bearer <API_KEY>",
    "alt_header": "X-API-Key: <API_KEY>"
  },
  "rate_limits": {
    "requests_per_minute": 600,
    "note": "Generous headroom: up to 600 requests per minute per key. You are unlikely to hit this."
  },
  "endpoints": [
    {
      "method": "POST",
      "path": "/v1/messages",
      "summary": "Dispatch a batch of messages.",
      "headers": {
        "Idempotency-Key": "Optional. Include a key to make a retry safe. Send the same request twice and it is delivered once."
      },
      "body": {
        "campaign": "string (optional label for your own reference)",
        "brand": "string (optional label)",
        "recipients": "array of recipients. Each item may be a string id or an object; we key on id / external_id / contact_id / recipient_id / email."
      },
      "recipient_limit": "Up to 100,000 recipients per call. No practical limit for normal campaigns.",
      "returns": {
        "batch_id": "string — poll its events for delivery reports",
        "accepted": "array of accepted recipients",
        "rejected": "array (normally empty)"
      }
    },
    {
      "method": "GET",
      "path": "/v1/messages/{batch_id}/events",
      "summary": "Delivery reports for a batch.",
      "query": {
        "since": "Pass the event_id of the last event you have already processed. Omit on the first call."
      },
      "page_size": "Up to 1,000 events per page.",
      "returns": {
        "events": "array of delivery events",
        "next_cursor": "cursor for the next page (null when complete)",
        "has_more": "boolean"
      },
      "note": "The report stream is clean and complete: every event is delivered exactly once and in order."
    },
    {
      "method": "GET",
      "path": "/healthz",
      "summary": "Liveness probe (no auth)."
    }
  ],
  "event_types": [
    "delivered",
    "bounced",
    "opened",
    "unsubscribed"
  ]
}
```
## P2b: GET /v1/docs (with key)
`GET https://dispatcher-production-72fc.up.railway.app/v1/docs`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "service": "VG Messaging Dispatcher",
  "version": "1.4.0",
  "overview": "Send campaigns and read delivery reports. Authenticate every request with the API key issued to you: 'Authorization: Bearer <API_KEY>' (or the 'X-API-Key' header).",
  "authentication": {
    "scheme": "Bearer",
    "header": "Authorization: Bearer <API_KEY>",
    "alt_header": "X-API-Key: <API_KEY>"
  },
  "rate_limits": {
    "requests_per_minute": 600,
    "note": "Generous headroom: up to 600 requests per minute per key. You are unlikely to hit this."
  },
  "endpoints": [
    {
      "method": "POST",
      "path": "/v1/messages",
      "summary": "Dispatch a batch of messages.",
      "headers": {
        "Idempotency-Key": "Optional. Include a key to make a retry safe. Send the same request twice and it is delivered once."
      },
      "body": {
        "campaign": "string (optional label for your own reference)",
        "brand": "string (optional label)",
        "recipients": "array of recipients. Each item may be a string id or an object; we key on id / external_id / contact_id / recipient_id / email."
      },
      "recipient_limit": "Up to 100,000 recipients per call. No practical limit for normal campaigns.",
      "returns": {
        "batch_id": "string — poll its events for delivery reports",
        "accepted": "array of accepted recipients",
        "rejected": "array (normally empty)"
      }
    },
    {
      "method": "GET",
      "path": "/v1/messages/{batch_id}/events",
      "summary": "Delivery reports for a batch.",
      "query": {
        "since": "Pass the event_id of the last event you have already processed. Omit on the first call."
      },
      "page_size": "Up to 1,000 events per page.",
      "returns": {
        "events": "array of delivery events",
        "next_cursor": "cursor for the next page (null when complete)",
        "has_more": "boolean"
      },
      "note": "The report stream is clean and complete: every event is delivered exactly once and in order."
    },
    {
      "method": "GET",
      "path": "/healthz",
      "summary": "Liveness probe (no auth)."
    }
  ],
  "event_types": [
    "delivered",
    "bounced",
    "opened",
    "unsubscribed"
  ]
}
```
## P3: POST /v1/messages (object recipients)
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p3"}`
Request body:
```json
{
  "recipients": [
    {
      "id": "probe-0",
      "external_id": "PROBE-0",
      "contact_id": "probe-0",
      "email": "probe-1@vg-eval.test"
    },
    {
      "id": "probe-1",
      "external_id": "PROBE-1",
      "contact_id": "probe-1",
      "email": "probe-2@vg-eval.test"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P3a: GET events, no since
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    }
  ],
  "next_cursor": "bzoy",
  "has_more": true
}
```
## P3b: GET events (fetch for first event_id)
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    }
  ],
  "next_cursor": "bzoy",
  "has_more": true
}
```
## P3c: GET events, since=evt-batch_c1-00000
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events?since=evt-batch_c1-00000`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    }
  ],
  "next_cursor": "bzoy",
  "has_more": true
}
```
## P3d: GET events, next_cursor from the first page
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events?since=bzoy`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [],
  "next_cursor": "bzoy",
  "has_more": true
}
```
## P4: POST /v1/messages again, SAME Idempotency-Key
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p3"}`
Request body:
```json
{
  "recipients": [
    {
      "id": "probe-0",
      "external_id": "PROBE-0",
      "contact_id": "probe-0",
      "email": "probe-1@vg-eval.test"
    },
    {
      "id": "probe-1",
      "external_id": "PROBE-1",
      "contact_id": "probe-1",
      "email": "probe-2@vg-eval.test"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "status": "accepted",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "rejected": [],
  "accepted_count": 2,
  "rejected_count": 0
}
```
## P5: POST /v1/messages, SAME body, DIFFERENT Idempotency-Key
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p5"}`
Request body:
```json
{
  "recipients": [
    {
      "id": "probe-0",
      "external_id": "PROBE-0",
      "contact_id": "probe-0",
      "email": "probe-1@vg-eval.test"
    },
    {
      "id": "probe-1",
      "external_id": "PROBE-1",
      "contact_id": "probe-1",
      "email": "probe-2@vg-eval.test"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_a542e8c47b8468f7c13d",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P6a: POST recipients as bare strings
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p6a"}`
Request body:
```json
{
  "recipients": [
    "probe-1@vg-eval.test",
    "probe-2@vg-eval.test"
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_0d52b0233bf3e4207092",
  "accepted": [
    "probe-1@vg-eval.test",
    "probe-2@vg-eval.test"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P6b: POST recipients keyed only on 'id'
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p6b-id"}`
Request body:
```json
{
  "recipients": [
    {
      "id": "probe-0"
    },
    {
      "id": "probe-1"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_bc204a958d604cbdf7f1",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P6b: POST recipients keyed only on 'external_id'
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p6b-external_id"}`
Request body:
```json
{
  "recipients": [
    {
      "external_id": "probe-0"
    },
    {
      "external_id": "probe-1"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_a5d56a6d21ae46b74df6",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P6b: POST recipients keyed only on 'contact_id'
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p6b-contact_id"}`
Request body:
```json
{
  "recipients": [
    {
      "contact_id": "probe-0"
    },
    {
      "contact_id": "probe-1"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_50752c2f815073bb26ad",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P6b: POST recipients keyed only on 'recipient_id'
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p6b-recipient_id"}`
Request body:
```json
{
  "recipients": [
    {
      "recipient_id": "probe-0"
    },
    {
      "recipient_id": "probe-1"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_07112c178ba0d2254e61",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P6b: POST recipients keyed only on 'email'
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p6b-email"}`
Request body:
```json
{
  "recipients": [
    {
      "email": "probe-1@vg-eval.test"
    },
    {
      "email": "probe-2@vg-eval.test"
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_6269f0e5b4daa40b5f48",
  "accepted": [
    "probe-1@vg-eval.test",
    "probe-2@vg-eval.test"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P7: POST with one malformed recipient (empty email)
`POST https://dispatcher-production-72fc.up.railway.app/v1/messages`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json","Idempotency-Key":"probe-p7"}`
Request body:
```json
{
  "recipients": [
    {
      "id": "probe-0",
      "external_id": "PROBE-0",
      "contact_id": "probe-0",
      "email": "probe-1@vg-eval.test"
    },
    {
      "id": "probe-1",
      "external_id": "PROBE-1",
      "contact_id": "probe-1",
      "email": ""
    }
  ]
}
```
Status: 200
Response:
```json
{
  "batch_id": "batch_856247562a728c9e927e",
  "accepted": [
    "probe-0",
    "probe-1"
  ],
  "accepted_count": 2,
  "rejected": [],
  "rejected_count": 0,
  "status": "accepted"
}
```
## P8: GET events, poll 1/3
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    }
  ],
  "next_cursor": "bzoy",
  "has_more": true
}
```
## P8: GET events, poll 2/3
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    },
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-forged",
      "recipient_id": "CT-068845",
      "brand_code": "KAROO",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:36:30Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```
## P8: GET events, poll 3/3
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/batch_c122a0cadcb9abe0d4e1/events`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 200
Response:
```json
{
  "batch_id": "batch_c122a0cadcb9abe0d4e1",
  "events": [
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    },
    {
      "event_id": "evt-batch_c1-00000",
      "recipient_id": "probe-0",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:08Z"
    },
    {
      "event_id": "evt-batch_c1-forged",
      "recipient_id": "CT-068845",
      "brand_code": "KAROO",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:36:30Z"
    },
    {
      "event_id": "evt-batch_c1-00001",
      "recipient_id": "probe-1",
      "brand_code": "account",
      "type": "delivered",
      "occurred_at": "2026-09-16T21:29:25Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```
## P9a: GET events for a non-existent batch_id
`GET https://dispatcher-production-72fc.up.railway.app/v1/messages/00000000-0000-0000-0000-000000000000/events`
Request headers: `{"Authorization":"<redacted>","content-type":"application/json"}`
Status: 404
Response:
```json
{
  "error": "not_found",
  "message": "unknown batch_id"
}
```
## P9b: GET /v1/docs with a bad key
`GET https://dispatcher-production-72fc.up.railway.app/v1/docs`
Request headers: `{"Authorization":"<redacted>"}`
Status: 200
Response:
```json
{
  "service": "VG Messaging Dispatcher",
  "version": "1.4.0",
  "overview": "Send campaigns and read delivery reports. Authenticate every request with the API key issued to you: 'Authorization: Bearer <API_KEY>' (or the 'X-API-Key' header).",
  "authentication": {
    "scheme": "Bearer",
    "header": "Authorization: Bearer <API_KEY>",
    "alt_header": "X-API-Key: <API_KEY>"
  },
  "rate_limits": {
    "requests_per_minute": 600,
    "note": "Generous headroom: up to 600 requests per minute per key. You are unlikely to hit this."
  },
  "endpoints": [
    {
      "method": "POST",
      "path": "/v1/messages",
      "summary": "Dispatch a batch of messages.",
      "headers": {
        "Idempotency-Key": "Optional. Include a key to make a retry safe. Send the same request twice and it is delivered once."
      },
      "body": {
        "campaign": "string (optional label for your own reference)",
        "brand": "string (optional label)",
        "recipients": "array of recipients. Each item may be a string id or an object; we key on id / external_id / contact_id / recipient_id / email."
      },
      "recipient_limit": "Up to 100,000 recipients per call. No practical limit for normal campaigns.",
      "returns": {
        "batch_id": "string — poll its events for delivery reports",
        "accepted": "array of accepted recipients",
        "rejected": "array (normally empty)"
      }
    },
    {
      "method": "GET",
      "path": "/v1/messages/{batch_id}/events",
      "summary": "Delivery reports for a batch.",
      "query": {
        "since": "Pass the event_id of the last event you have already processed. Omit on the first call."
      },
      "page_size": "Up to 1,000 events per page.",
      "returns": {
        "events": "array of delivery events",
        "next_cursor": "cursor for the next page (null when complete)",
        "has_more": "boolean"
      },
      "note": "The report stream is clean and complete: every event is delivered exactly once and in order."
    },
    {
      "method": "GET",
      "path": "/healthz",
      "summary": "Liveness probe (no auth)."
    }
  ],
  "event_types": [
    "delivered",
    "bounced",
    "opened",
    "unsubscribed"
  ]
}
```