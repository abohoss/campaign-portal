# Acceptance criteria

> Written before any application code, per `docs/IMPLEMENTATION_PLAN.md` §8 Phase 1. Every criterion
> has a stable ID and maps to at least one automated test naming that ID (enforced by
> `scripts/check-ac-coverage.ts`, Phase 2). IDs are never renumbered — a criterion cut later is
> struck through, not deleted, so the ID space stays stable.
>
> Where a criterion references a concrete number or id (e.g. "81,215 contacts", "CT-000016"), that
> number comes from `docs/DATA_FINDINGS.md` (regenerate with `npm run profile`) and is real seed
> data, not an example. Tests should use the real seed rows named here as fixtures.
>
> **⛳ Human checkpoint: review this file before implementation starts.**

Families: [AUTH](#ac-auth) (8) · [ISO](#ac-iso) (7) · [IMP](#ac-imp) (12) · [NUM](#ac-num) (9) ·
[SCALE](#ac-scale) (3) · [SEND](#ac-send) (12) · [EVT](#ac-evt) (10) · [SHARE](#ac-share) (9) ·
[UX](#ac-ux) (7) · [APP](#ac-app) (4). **81 criteria total.**

---

## AC-AUTH — six logins, two sign-in methods, role separation

### AC-AUTH-01 — Kilele owner lands in the Kilele portal
- **Given** the Kilele owner's allowlisted email and password
- **When** they sign in with email/password
- **Then** they land on the Kilele dashboard, and every subsequent PostgREST request they make
  returns only `brand_id = <Kilele's id>` rows.

### AC-AUTH-02 — Kilele analyst lands in the Kilele portal, read-only
- **Given** the Kilele analyst's allowlisted email and password
- **When** they sign in with email/password
- **Then** they land on the Kilele dashboard, see contacts/campaigns/dashboard, and the UI renders
  no Send affordance anywhere.

### AC-AUTH-03 — all six logins land in their own brand, parametrised
- **Given** each of the six allowlisted accounts (Kilele owner/analyst, Karoo owner/analyst,
  Marrakech owner/analyst)
- **When** each signs in with email/password in turn
- **Then** each lands on their own brand's portal and none of the other five brand-pairs' data is
  visible to them.

### AC-AUTH-04 — Google sign-in works for an allowlisted account
- **Given** one of the six allowlisted emails, provisioned as a Google account
- **When** that person signs in via "Continue with Google"
- **Then** they land on their own brand's portal, identically to AC-AUTH-01/02, and a `memberships`
  row exists for them with the correct brand and role.

### AC-AUTH-05 — an outsider is rejected at user creation, both methods
- **Given** an email that is **not** in `allowed_emails`
- **When** that email attempts to sign up with a password, and separately when a Google account
  using that email attempts to sign in
- **Then** both attempts are rejected by the `before-user-created` hook, no row is ever created in
  `auth.users`, and no `memberships` row is ever created.

### AC-AUTH-06 — a user with no membership sees nothing, everywhere
- **Given** a user who exists in `auth.users` (e.g. seeded directly, bypassing the normal flow) but
  has zero rows in `memberships`
- **When** they sign in and load the app, and separately when they query any tenant table directly
  via PostgREST with their own JWT
- **Then** the UI shows an explicit "no access" screen (not a blank page, not a crash, not another
  brand's data), and every direct PostgREST query returns zero rows.

### AC-AUTH-07 — an analyst cannot send, UI and API both
- **Given** the Karoo analyst, signed in
- **When** they look for a way to send a campaign in the UI, and separately when they call the
  `confirm_send` RPC directly (e.g. from the browser console) with a valid `send_id`
- **Then** the UI shows no Send control, and the direct RPC call is rejected with an
  insufficient-privilege error and does not change the send's status.

### AC-AUTH-08 — session persists and sign-out actually clears it
- **Given** a signed-in user
- **When** they reload the page
- **Then** they remain signed in without re-entering credentials; **and when** they sign out and
  reload, **then** they land on the sign-in screen and a direct PostgREST call with the old token
  (if still cached client-side) reads no protected data.

---

## AC-ISO — a brand sees its own data and nothing else, ever

### AC-ISO-01 — RLS is enabled and forced on every table, always
- **Given** the current `public` schema
- **When** the catalog-driven isolation test enumerates `pg_class` for every `relkind='r'` table
- **Then** every one has both `relrowsecurity = true` and `relforcerowsecurity = true` — including
  any table added after this was written, with no per-table allowlist in the test itself.

### AC-ISO-02 — a brand-A user reads zero brand-B rows, on every brand-scoped table
- **Given** the Karoo analyst, signed in with the real anon key
- **When** they `select *` from every table in `public` that has a `brand_id` column
- **Then** every row returned has `brand_id = <Karoo's id>` and zero rows from Kilele or Marrakech
  appear anywhere.

### AC-ISO-03 — cross-brand writes are rejected, not just cross-brand reads
- **Given** the Kilele owner, signed in
- **When** they attempt to `insert`, `update`, or `delete` a row on `contacts`, `campaigns`, or
  `sends` whose `brand_id` is Karoo's
- **Then** every attempt is rejected by RLS (not silently no-op'd, not partially applied).

### AC-ISO-04 — cross-brand contamination in the seed never lands under either brand
- **Given** the 312 rows in `kilele-contacts.csv` carrying `brand_code=KAROO` and the 88 rows in
  `karoo-contacts.csv` carrying `Brand Code=KILELE`
- **When** each brand's contacts file is imported
- **Then** none of those 400 rows appear in `contacts` under **either** brand — they are rejected as
  `BRAND_MISMATCH` and reported in `import_errors`, not silently dropped and not re-homed.

### AC-ISO-05 — a user cannot grant themselves a membership
- **Given** any authenticated user, including an owner
- **When** they attempt to `insert` a row into `memberships` (for themselves, for a brand they
  already belong to, or for one they don't)
- **Then** the insert is rejected — `memberships` has no insert policy of any kind, for any role.

### AC-ISO-06 — the anonymous role reads nothing
- **Given** no session at all (the raw anon key, unauthenticated)
- **When** a request is made to every tenant table in `public`
- **Then** every one returns zero rows or a permission error.

### AC-ISO-07 — breaking isolation breaks the tests, provably
- **Given** the documented four-step manual break-check in `docs/ISOLATION_BREAK_CHECK.md`
  (un-force RLS on `contacts`; add a permissive policy; weaken `authorize()` to `select true`)
- **When** each step is applied in a scratch database and `npm run test:isolation` is run
- **Then** the suite fails at the specific assertion named in the break-check doc, and passes again
  after `supabase db reset` — with the actual failing output captured as evidence.

---

## AC-IMP — data loads, the marketer sees what didn't, re-import is a no-op

### AC-IMP-01 — Kilele's full contacts file imports to the expected count
- **Given** `seed/kilele-contacts.csv` (83,993 data rows after excluding the 7 mid-file blank lines,
  81,215 distinct `external_id`s)
- **When** it is imported for the first time
- **Then** `import_runs.status = 'succeeded'` (or `'partial'` if any row is rejected) and exactly
  81,215 contacts exist for Kilele afterward.

### AC-IMP-02 — short/shifted rows are rejected with the right reason, not repaired
- **Given** the 70 short/shifted rows in `kilele-contacts.csv` (e.g. `CT-904924` at row 277, which
  has 9 of 13 fields)
- **When** the file is imported
- **Then** each appears in `import_errors` with `reason_code = 'COLUMN_COUNT_MISMATCH'`, the correct
  1-based row number, and is **not** written to `contacts` under any shifted interpretation of its
  columns.

### AC-IMP-03 — the cp1252 Karoo file imports without throwing, names intact
- **Given** `seed/karoo-contacts.csv`, which is not valid UTF-8 (fails at byte 76,980) and contains
  names like `Seán O'Connor` and `Ann–Marie Botha`
- **When** it is imported
- **Then** the import completes (falls back to cp1252 decoding, `import_runs.detected_encoding`
  records the fallback) and those names are stored correctly, not mangled or replaced with a
  replacement character.

### AC-IMP-04 — Marrakech's semicolon file with French headers and decimal-comma spend imports
- **Given** `seed/marrakech-contacts.csv` (`;`-delimited, headers `e_mail`/`mobile`/`pays`) and
  `seed/marrakech-campaigns.csv` (spend values like `221,09`)
- **When** both are imported
- **Then** contacts land with `email`/`phone`/`country` correctly mapped from the aliased headers,
  and campaign `spend` parses to `221.09`, not `221` or a parse failure.

### AC-IMP-05 — malformed emails are rejected at the field level, the contact still imports
- **Given** the 1,648 malformed emails in `kilele-contacts.csv` (e.g. `'john doe@vg-eval.test'`,
  `'missing-at-sign.test'`, `'double@@vg-eval.test'`)
- **When** the file is imported
- **Then** each produces an `import_errors` row with `field = 'email'`,
  `reason_code = 'INVALID_EMAIL'`, the contact is still created with `email = NULL`, and it is
  excluded from the contactable count.

### AC-IMP-06 — case/whitespace-only duplicate emails collapse to one contact
- **Given** `CT-007796`, which appears twice in `kilele-contacts.csv` differing only in email
  case/padding (`'  JAMES.WANJIRU.KIL7488@VG-EVAL.TEST '` vs `'james.wanjiru.kil7488@vg-eval.test'`)
- **When** the file is imported
- **Then** exactly one `contacts` row exists for `CT-007796`, with the normalised
  (trimmed+lowercased) email from whichever row appeared last in the file.

### AC-IMP-07 — cross-brand rows are rejected under both brands (see also AC-ISO-04)
- **Given** the 312 `KAROO`-branded rows inside `kilele-contacts.csv`
- **When** Kilele's file is imported and, separately, Karoo's file (containing its own 88
  `KILELE`-branded rows) is imported
- **Then** all 400 rows are rejected with `BRAND_MISMATCH` and `contacts` contains zero rows from
  either contamination set under either brand.

### AC-IMP-08 — the embedded header row is rejected, not imported as a contact
- **Given** the data row at index 39,998 of `kilele-contacts.csv`, whose every field equals its own
  column name (`external_id='external_id'`, `city='city'`, …)
- **When** the file is imported
- **Then** it is rejected with `reason_code = 'EMBEDDED_HEADER_ROW'` and no contact literally named
  `external_id` is ever created.

### AC-IMP-09 — importing the same file twice is a no-op
- **Given** `kilele-contacts.csv` already imported once (81,215 contacts)
- **When** the identical file is imported a second time
- **Then** `contacts` still contains exactly 81,215 rows, the second `import_runs.inserted_count = 0`,
  and no duplicate rows are created for any `external_id`.

### AC-IMP-10 — the September delta replaces overlapping contacts field-for-field
- **Given** `CT-000016` exists in the main file (name `Diana Mokoena`, email
  `yassine.vermeulen.kil16@…`, city `Machakos`) and also in the delta file, with entirely different
  values (name `Fatima Odhiambo`, email `rose.cheruiyot.delta665@…`, city `Kisumu`,
  `notes='corrected in Sept export'`)
- **When** the main file is imported, then the delta file is imported afterward
- **Then** `CT-000016` reflects every delta field, not a merge of old and new, and the 1,680
  delta-only ids (all new, August 2026 signups) are added as new contacts.

### AC-IMP-11 — orphan Marrakech events quarantine instead of inventing campaigns
- **Given** the 633 of 940 Marrakech events referencing campaigns `MAR-0007`–`MAR-0018`, which do
  not exist in `marrakech-campaigns.csv`
- **When** Marrakech's events are loaded
- **Then** all 633 land in `event_quarantine` with `reason_code = 'UNKNOWN_CAMPAIGN'`, the UI surfaces
  the count, and no stub `campaigns` rows are auto-created for `MAR-0007`..`MAR-0018`.

### AC-IMP-12 — applying the delta before the main file is caught, not silently wrong
- **Given** a brand-new Supabase project with no contacts imported yet
- **When** an owner uploads `kilele-contacts-delta-2026-09-01.csv` before ever uploading
  `kilele-contacts.csv`
- **Then** the UI warns that this delta looks like a correction file with no base import to apply
  against, rather than silently treating the 1,680 new + 2,500 "correction" rows as if they were the
  brand's entire customer base.

---

## AC-NUM — the numbers are right, and say how they were counted

### AC-NUM-01 — total customers excludes deleted contacts
- **Given** Kilele's 417 contacts with a non-null `deleted_at`
- **When** the dashboard's "Total customers" figure is computed
- **Then** those 417 are excluded, and the on-screen note says so.

### AC-NUM-02 — blank consent is not contactable
- **Given** the 9,511 Kilele contacts with blank/null `consent_marketing`
- **When** the "Contactable" figure is computed
- **Then** those 9,511 are excluded (unknown consent ≠ granted consent), and the counting note states
  this explicitly.

### AC-NUM-03 — suppression is time-bound, correctly
- **Given** the 481 Kilele contacts with a `suppressed_until` date, every one of which is currently
  in the future
- **When** the "Contactable" figure is computed today
- **Then** all 481 are excluded as currently suppressed; **and** a contact whose `suppressed_until`
  is set to a past date (synthetic test fixture) is included.

### AC-NUM-04 — the 30-day signup window is anchored to now, not to the data
- **Given** Karoo's and Marrakech's most recent signup is 2026-04-17, and today is after that date
- **When** "Signups per day, last 30 days" is computed for Karoo and Marrakech
- **Then** the window is `now() - 30 days .. now()` and returns 30 days of zero, **not** a window
  silently shifted to end on the data's last signup.

### AC-NUM-05 — the empty 30-day chart explains itself
- **Given** AC-NUM-04's zero-signup window for Karoo/Marrakech
- **When** the dashboard renders that chart
- **Then** it shows an explicit empty state naming the most recent signup date in that brand's data
  (17 Apr 2026), not a blank chart, a spinner, or a silently-shifted date range.

### AC-NUM-06 — signup buckets use the brand's own timezone
- **Given** Kilele (`Africa/Nairobi`, UTC+3), Karoo (`Africa/Johannesburg`, UTC+2), and Marrakech
  (`Africa/Casablanca`, UTC+1)
- **When** a signup at `2026-03-01T22:30:00Z` is bucketed for a Kilele contact
- **Then** it is counted on `2026-03-02` (Nairobi local), not `2026-03-01` (UTC) — verified at this
  exact day-boundary case for all three brands.

### AC-NUM-07 — open rate divides by delivered, and handles zero cleanly
- **Given** a campaign's unique-opens and delivered counts
- **When** "Open rate" is computed
- **Then** it is `unique opens ÷ delivered` (never `÷ sent`), and when delivered is 0 the UI shows
  "—", never `NaN`, `Infinity`, or a divide-by-zero error.

### AC-NUM-08 — inconsistent campaigns are flagged, not silently reconciled
- **Given** the 6 Kilele campaigns (e.g. `KIL-0016`) where `reported_opens > reported_delivered`
- **When** those campaigns are viewed
- **Then** a data-quality banner explains the inconsistency, and both the reported and (where
  computable) the engagement-log-derived figures are shown side by side, not merged into one
  "corrected" number.

### AC-NUM-09 — every ambiguous figure carries its counting rule on screen
- **Given** the full set of ambiguous metrics (§6 of the implementation plan)
- **When** the dashboard renders
- **Then** an automated DOM check finds a non-empty `<CountingNote>` adjacent to every one of them —
  the build fails if a new ambiguous metric ships without one.

---

## AC-SCALE — as usable for the big brand as the small one

### AC-SCALE-01 — Kilele's 84k-row import completes without timing out
- **Given** `kilele-contacts.csv` (83,993 rows, 11.6MB) and `kilele-events.csv` (312,000 rows, 22MB)
- **When** each is imported/loaded via the chunked worker
- **Then** the run completes (possibly across several worker invocations) without any single
  invocation exceeding the Edge Function time limit, and the UI shows live progress throughout.

### AC-SCALE-02 — no query ever fetches more than 1,000 rows
- **Given** Kilele's contacts list (81k+ rows) and the PostgREST default row cap of 1,000
- **When** the contacts view is paged through and the dashboard totals are loaded
- **Then** the contacts list uses server-side keyset pagination (never `.select('*')` with no limit),
  and every dashboard total comes from a SQL aggregate function, never a client-side `.length` on a
  fetched array — enforced by an ESLint rule in `features/dashboard/**`.

### AC-SCALE-03 — Marrakech and Kilele share one code path
- **Given** Marrakech (957 contacts) and Kilele (81k+ contacts)
- **When** each brand's dashboard and contacts view are loaded
- **Then** both render via the identical components and query shape — there is no brand-size branch
  in the UI code.

---

## AC-SEND — sending is safe and honest

### AC-SEND-01 — the preview count matches the frozen audience
- **Given** an owner selecting a campaign to send
- **When** they preview the send
- **Then** `preview_send` freezes the contactable audience into `send_recipients` and the count shown
  equals `count(*) from send_recipients where send_id = ...`.

### AC-SEND-02 — the confirm screen's count is the count that gets approved
- **Given** a previewed draft send with `snapshot_count = N`
- **When** the owner reaches the confirm screen
- **Then** the displayed count is exactly `N`, sourced from `sends.snapshot_count`, not recomputed
  live from `contacts`.

### AC-SEND-03 — double confirm from two sessions approves exactly once
- **Given** one draft send, and 20 concurrent `confirm_send` calls against it (simulating two
  browser sessions racing, amplified for a reliable test)
- **When** all 20 fire at once
- **Then** exactly one succeeds and transitions the send to `approved`; the other 19 fail with
  `send_already_confirmed`, and the partial unique index never allows two active sends on one
  campaign.

### AC-SEND-04 — a stale expected count is rejected, not silently accepted
- **Given** a draft send whose `snapshot_count` is 500, but the client sends `p_expected_count = 499`
  (e.g. the screen was stale)
- **When** `confirm_send` is called with the mismatched count
- **Then** it is rejected with `count_changed` and the send remains `draft`.

### AC-SEND-05 — an analyst cannot confirm even by calling the RPC directly
- **Given** the Karoo analyst's valid session and a real Karoo draft send
- **When** they call `confirm_send` directly (bypassing the UI, e.g. via the browser console)
- **Then** the call is rejected server-side and the send remains `draft`.

### AC-SEND-06 — only one active send per campaign, ever
- **Given** a campaign with an existing `draft` send
- **When** the owner previews the same campaign again before confirming or cancelling the first
- **Then** the existing draft is reused (same `send_id`, refreshed snapshot), not duplicated —
  enforced by `sends_one_active_per_campaign`.

### AC-SEND-07 — a killed worker resumes without double-sending
- **Given** a send worker killed mid-way through chunk 3 of 5, after chunk 3's `idempotency_key` was
  persisted but before its HTTP response was recorded
- **When** the worker restarts
- **Then** it retries chunk 3 with the **same** `idempotency_key`, and no recipient in chunks 1–2 or
  4–5 is sent more than once.

### AC-SEND-08 — the idempotency key is durable before the network call
- **Given** any chunk about to be sent
- **When** the worker processes it
- **Then** `send_chunks.idempotency_key` is committed to the database **before** the `POST
  /v1/messages` call is made — verified by asserting the row exists even if the HTTP call is made to
  fail deterministically in the test.

### AC-SEND-09 — an approved send's audience is frozen, immune to later contact changes
- **Given** an approved send with a `send_recipients` snapshot of 500 contacts
- **When** 50 of the underlying `contacts` rows are subsequently deleted or their status changed
- **Then** the send detail screen still reports 500 recipients from the snapshot, unaffected by the
  live `contacts` table.

### AC-SEND-10 — an old approval still reads as approved
- **Given** a `sends` row approved weeks ago
- **When** it is viewed today
- **Then** it still displays `status = 'approved'` (or its terminal state), derived from the stored
  row, not recomputed from current data in a way that could flip it.

### AC-SEND-11 — a non-empty `rejected[]` from the provider is never dropped
- **Given** a provider response whose `rejected[]` array is non-empty (contradicting the docs'
  "normally empty")
- **When** the send worker processes that chunk's response
- **Then** every rejected recipient is persisted with its reason in `send_recipients` and visible on
  the send detail screen.

### AC-SEND-12 — recipients are sent with every key field populated
- **Given** the provider's documented ambiguity about which field it keys recipients on (`id` /
  `external_id` / `contact_id` / `recipient_id` / `email`)
- **When** the worker builds a chunk's request body
- **Then** each recipient object includes `external_id`, `email`, and `contact_id` together, so
  ingestion can resolve the recipient regardless of which field the provider echoes back.

---

## AC-EVT — the provider talks back, and the picture stays correct

### AC-EVT-01 — one event, one state change
- **Given** a single delivery event for one recipient
- **When** it is ingested
- **Then** exactly one `engagement_events` row is created and the recipient's flags update once.

### AC-EVT-02 — the same event, duplicated 5×, changes state once
- **Given** one `provider_event_id` delivered 5 times (simulating the "duplicated" behaviour the
  brief warns about)
- **When** all 5 copies are ingested, in any order
- **Then** `provider_events_raw`/`engagement_events` contain exactly one row for that event id, and
  the recipient's state reflects it exactly once.

### AC-EVT-03 — out-of-order arrival converges to the same state as in-order
- **Given** an `opened` event and a `bounced` event for the same recipient, generated in one order
- **When** they are ingested in the reverse order
- **Then** the final `send_recipients` flags and `contacts.status` are identical to the in-order
  case.

### AC-EVT-04 — opened implies delivered
- **Given** a recipient who has an `opened` event but no explicit `delivered` event
- **When** the event is ingested
- **Then** `has_delivered = true` is set alongside `has_opened = true`.

### AC-EVT-05 — unsubscribed is sticky against a later open
- **Given** a recipient with an `unsubscribed` event already applied
- **When** an `opened` event for the same recipient (timestamped after the unsubscribe) is ingested
- **Then** `contacts.status` remains `unsubscribed` and `consent_marketing` remains `false` — it is
  never resurrected to contactable.

### AC-EVT-06 — a crash mid-ingest loses nothing and skips nothing
- **Given** a batch of events where the ingest transaction is forced to fail partway through
  (simulated)
- **When** the function is retried
- **Then** the cursor was never advanced past the failed batch (it moved in the same transaction as
  the inserts), so the retry reprocesses that batch from the same point and every event is eventually
  applied exactly once.

### AC-EVT-07 — an unresolvable recipient is quarantined, not dropped
- **Given** an event whose recipient identifier matches none of `external_id`, `contact_id`, or
  `email` on file
- **When** it is ingested
- **Then** it is written to `event_quarantine` with `reason_code = 'UNKNOWN_RECIPIENT'`, and the
  batch continues processing the remaining events.

### AC-EVT-08 — an unknown event type is quarantined, not dropped
- **Given** an event whose `event_type` is outside the canonical enum
- **When** it is ingested
- **Then** it is written to `event_quarantine` with `reason_code = 'UNKNOWN_EVENT_TYPE'`, and the
  batch continues.

### AC-EVT-09 — a bounce propagates to contactability immediately
- **Given** a contact who was previously contactable
- **When** a `bounced` event for them is ingested
- **Then** `contacts.status` becomes `bounced`, and the next dashboard load excludes them from
  "Contactable" without requiring a manual refresh of anything besides the page.

### AC-EVT-10 — sync runs automatically, and on demand
- **Given** the deployed project
- **When** `cron.job` is queried
- **Then** an active job invokes `sync-events` on a one-minute schedule; **and** pressing "Sync now"
  in the UI triggers an immediate run outside that schedule.

---

## AC-SHARE — safe to send to a stranger

### AC-SHARE-01 — anon cannot read share_links, period
- **Given** the anon key, no session
- **When** `select * from share_links` is attempted directly via PostgREST
- **Then** it returns zero rows or a permission error — `share_links` has no SELECT policy for any
  role reachable by the anon key.

### AC-SHARE-02 — the plaintext token is shown exactly once
- **Given** an owner creating a share link for a campaign
- **When** the link is created
- **Then** the plaintext token is returned in that response only; only its SHA-256 is stored, and no
  subsequent API call (including as the owner) can retrieve the plaintext again.

### AC-SHARE-03 — wrong token and wrong password look identical
- **Given** a valid share link
- **When** it is accessed with a wrong token (right password) and, separately, with the right token
  and a wrong password
- **Then** both responses have the same HTTP status and the same body shape — no information
  distinguishes "no such link" from "wrong password".

### AC-SHARE-04 — brute force is rate-limited and uniformly rejected
- **Given** 1,000 random token guesses against `share-view`
- **When** they are all sent
- **Then** every one fails with the identical error from AC-SHARE-03, and the rate limiter engages
  before the full 1,000 complete for a single source.

### AC-SHARE-05 — the response contains no PII
- **Given** a valid token and password
- **When** the share page loads
- **Then** the response body contains aggregate campaign metrics only — a scan for any seed email,
  phone number, full name, or `external_id` in the response finds none.

### AC-SHARE-06 — revocation actually revokes
- **Given** a share link with correct token and password, then revoked by its owner
- **When** it is accessed again after revocation
- **Then** it fails with the same generic error as AC-SHARE-03, even though the credentials are
  otherwise correct.

### AC-SHARE-07 — one link, one campaign, no pivoting
- **Given** a valid share link scoped to campaign X
- **When** the request is tampered with (e.g. a different `campaign_id` injected client-side, if such
  a parameter existed)
- **Then** the response is still scoped server-side to the campaign the token was created for —
  there is no client-suppliable campaign identifier that can widen the response.

### AC-SHARE-08 — the token never appears where it could leak
- **Given** the share page and its underlying API call
- **When** the token is transmitted
- **Then** it travels only in a POST body, never in a URL query string or path segment, and does not
  appear in the `Referer` header of any subsequent request the page makes.

### AC-SHARE-09 — expiry is enforced
- **Given** a share link with `expires_at` in the past
- **When** it is accessed with the correct token and password
- **Then** it fails with the same generic error as AC-SHARE-03.

---

## AC-UX — it behaves when things go wrong

### AC-UX-01 — bad input is rejected before it reaches the database
- **Given** a malformed request (e.g. a non-UUID `campaign_id`, a negative `expected_count`)
- **When** it is submitted through any form or RPC call
- **Then** a zod schema rejects it client-side with a field-level error before any network call is
  made that could write it.

### AC-UX-02 — a campaign with zero events shows a legitimate zero, not a broken screen
- **Given** `KIL-0033`, `KIL-0034`, `KIL-0035` (Kilele) and `CMP-014` (Karoo), which have zero events
  in the seed
- **When** their campaign detail page loads
- **Then** it renders "No engagement recorded yet" cleanly, not a spinner stuck forever or a thrown
  error.

### AC-UX-03 — a database constraint catches what the client didn't
- **Given** the `contacts_signup_not_future` CHECK constraint
- **When** a row is written directly (bypassing client-side validation, e.g. via a crafted PostgREST
  call) with a `signup_at` far in the future
- **Then** the database rejects the write.

### AC-UX-04 — every data view has a loading state
- **Given** any screen backed by a TanStack Query hook
- **When** the query is in flight
- **Then** an explicit loading indicator renders — never a blank area indistinguishable from "there
  is no data here".

### AC-UX-05 — every data view has an empty state
- **Given** any screen backed by a TanStack Query hook
- **When** the query legitimately resolves to zero rows
- **Then** an explicit, specific empty state renders (not a generic "no data" with no context).

### AC-UX-06 — every data view has an error state with retry
- **Given** any screen backed by a TanStack Query hook
- **When** the query fails (network error, server error)
- **Then** an explicit error state renders with a retry action, not a silent failure or a raw stack
  trace.

### AC-UX-07 — a render crash doesn't take down the whole app
- **Given** a component that throws during render (simulated)
- **When** that error occurs
- **Then** the nearest `ErrorBoundary` catches it and shows a recovery screen; the rest of the app
  (navigation, other routes) remains usable.

---

## AC-APP — a real web app

### AC-APP-01 — the app is reachable at a public URL
- **Given** the deployed build
- **When** it is opened from a fresh browser profile with no prior state
- **Then** it loads over HTTPS at the submitted URL with no VPN, allowlist, or local network
  requirement.

### AC-APP-02 — every core screen works at phone width
- **Given** the dashboard, contacts, campaigns, send, and share screens
- **When** each is viewed at 375px width
- **Then** there is no horizontal page scroll, tables become card layouts where appropriate, and
  every interactive control is at least 44×44px.

### AC-APP-03 — no secret ever ships to the browser
- **Given** the built, deployed frontend bundle
- **When** its assets are grepped for the service-role key, the provider API key, and any of the six
  account passwords
- **Then** none of them appear anywhere in the shipped JavaScript, source maps, or HTML.

### AC-APP-04 — a full reload on a protected route never crashes
- **Given** a signed-in user on, e.g., a campaign detail page
- **When** they hard-reload the browser
- **Then** the session re-establishes and the same page renders correctly, or (if the session
  expired) they are cleanly redirected to sign-in — never a white screen or a thrown error.
