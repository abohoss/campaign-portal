# Campaign Portal

**Live:** https://campaign-portal-henna.vercel.app

A multi-tenant client campaign portal for three Velocity Growth brands — Kilele Rides (Kenya),
Karoo Coaches (South Africa), and Marrakech Express (Morocco) — built on Supabase (Postgres, Auth,
Edge Functions, Storage, pg_cron) and a Vite/React/TypeScript SPA.

Full build history and the reasoning behind every real-world deviation from the original design
lives in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — each phase section has a
**"What actually happened"** note documenting the real bugs the real data and the real deployed
project surfaced, and why the fix is what it is. [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) has the
full Given/When/Then acceptance criteria every feature was built against.

## The deployed app uses the anon key only

The Vercel deployment is configured with exactly two environment variables:
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. No service-role key, no provider API key, and no
other secret ever ships to the browser — every privileged operation (import processing, send
dispatch, event sync, the share-link password check) runs server-side, in a Postgres SECURITY
DEFINER function or a service-role Edge Function, never in client code.

## Where the data-isolation guarantee lives

[`supabase/migrations/0003_rls_policies.sql`](supabase/migrations/0003_rls_policies.sql), in
`public.authorize()` (line 18) — one SECURITY DEFINER helper that every RLS policy on every tenant
table delegates to. Change that one function and you change tenancy for every table at once.
`scripts/verify-rls.ts` (`npm run verify:rls`) checks, against the real live project, that RLS is
enabled **and forced** on every table in `public`, and that every SELECT policy calls `authorize()`
— the one documented exception is `memberships`, scoped directly by `user_id = auth.uid()` (using
`authorize()` there would be circular, since `authorize()` itself queries `memberships`).
[`docs/ISOLATION_BREAK_CHECK.md`](docs/ISOLATION_BREAK_CHECK.md) has the real output of deliberately
breaking that guarantee and watching the check fail.

## Architecture

```
apps/web/               Vite + React + TypeScript SPA. Anon key only (see above).
packages/domain/         Pure TypeScript — import validation/normalisation, metric definitions,
                          event precedence. Zero framework imports, enforced by
                          .dependency-cruiser.cjs. This is what StrykerJS mutation-tests.
supabase/migrations/     The real, applied schema — see schema.sql below for how it's exported.
supabase/functions/      Edge Functions, all service-role: import-start, import-worker,
                          send-worker, sync-events, share-view.
scripts/                 Seed profiling, user provisioning, the provider probe, real-data import
                          drivers, RLS verification, mutation-test sandboxing.
tests/integration/       Tests against the real cloud Supabase project. Read-only except for
                          send.test.ts and share.test.ts, which are explicitly scoped to
                          sends/send_recipients/send_chunks and share_links/share_link_attempts —
                          new, feature-specific tables, cleaned up in every file's afterAll, never
                          contacts/campaigns/engagement_events.
docs/                    The implementation plan (with real "what actually happened" notes per
                          phase), acceptance criteria, data findings, provider probe results,
                          manual setup tracking.
```

### Tables

`brands` · `memberships` · `allowed_emails` · `contacts` · `campaigns` · `engagement_events` ·
`import_runs` · `import_errors` · `sends` · `send_recipients` · `send_chunks` ·
`provider_events_raw` · `event_quarantine` · `share_links` · `share_link_attempts`

### Functions (all `SECURITY DEFINER`, each re-checking `authorize()` or gated by an explicit
`GRANT` to a specific role — see [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for
why `security_invoker` was tried first and rejected)

`authorize` · `apply_import_chunk` · `dashboard_totals` · `dashboard_signups_daily` ·
`dashboard_campaign_performance` · `contacts_page` · `preview_send` · `confirm_send` ·
`ingest_provider_event` · `advance_events_cursor` · `create_share_link` · `revoke_share_link` ·
`share_view`

## Local setup

```bash
npm install
npm run profile        # regenerates docs/DATA_FINDINGS.md from seed/, verifying seed integrity first
npm run gate           # typecheck, lint, dependency rules, coverage, integration tests, mutation testing
```

This build never had a working local Postgres — a Docker Desktop crash corrupted WSL state early
on (see Phase 3's "what actually happened" note) — so all development and all integration testing
runs against the one real cloud Supabase project. `.env.local` and `apps/web/.env.local` (both
gitignored) hold that project's URL/keys; see [`docs/MANUAL_SETUP.md`](docs/MANUAL_SETUP.md) for
what's provisioned. `tests/integration/**` skips gracefully (not a failure) without
`docs/CREDENTIALS.local.json`, which only exists on a machine that's run
`scripts/provision-users.ts` against the real project.

`schema.sql` at the repo root is the full applied schema, exported by concatenating
`supabase/migrations/*.sql` in application order (0001 → 0017) rather than a `pg_dump` — the same
no-local-Postgres constraint applies to `supabase db dump`, and a concatenation of the actual
applied migrations, comments included, is a more faithful and more explicable record of what ran
than a bare dump would be.

## Quality gate

`npm run gate` chains `typecheck` → `lint` → `depcruise` → `test:coverage` → `test:integration` →
`mutation`. Coverage thresholds (85%/80% overall, 95%/90% in `packages/domain`) live in
`vitest.config.ts`; the mutation threshold (75% break) lives in `stryker.conf.json`, scoped to
`packages/domain/src/**` only. `npm run mutation` runs through `scripts/run-mutation.ts`, which
hides `vitest.workspace.ts` for the duration of the Stryker run — Vitest auto-discovers that file
by filename regardless of Stryker's own explicit config, which without this wrapper meant every
mutant iteration re-ran the real, live-project-writing integration suite hundreds of times.

## What mutation testing does not cover

StrykerJS mutates TypeScript only — `packages/domain/src/**`. It never touches SQL, so RLS
policies, `confirm_send`, `ingest_provider_event`, the partial unique index, and the share-link
functions carry no mutation score. Those guarantees are protected instead by:

| SQL guarantee | Protected by |
|---|---|
| RLS enabled + forced everywhere | `scripts/verify-rls.ts`, run against the real live project |
| `authorize()` correctness | `tests/integration/auth.test.ts`, real sign-ins as all six provisioned accounts with the real anon key |
| One approved send per campaign | `tests/integration/send.test.ts`'s AC-SEND-03 — 20 real concurrent `confirm_send` calls against the live project |
| Approved count = displayed count | `tests/integration/send.test.ts`'s AC-SEND-04 (stale count rejected) |
| An analyst can never confirm a send | `tests/integration/send.test.ts`'s AC-SEND-05, a real analyst account against the real RPC |
| Event convergence (any shuffle/duplication → identical final state) | `packages/domain/src/events.test.ts`'s `events.convergence.prop`/`events.sticky.prop` (fast-check), which `ingest_provider_event` applies verbatim in SQL — proven in TS, applied in SQL, not re-proven against a database |
| Cross-tenant event leakage | `ingest_provider_event` resolves every recipient scoped to `send_id`, not just `id` — the direct fix for a real cross-tenant leak the Phase 7 provider probe found; see `docs/PROVIDER_PROBE.md` |
| Share link access boundary | `tests/integration/share.test.ts` — anon has no `SELECT`, wrong token and wrong password produce byte-identical responses, a revoked link fails, all against the real deployed `share-view` function |
| Event-ingest/cursor functions unreachable except by service role | `tests/integration/events.test.ts`, a real signed-in owner attempting both RPCs directly |

## AI tools used

**Claude Code** (Anthropic), running Claude Sonnet 5, built this entire repository — every
migration, Edge Function, React component, test, and documentation file except for
[`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md), which I wrote and then polished using Claude Code,
across all 11 phases of
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md), operating with direct access to the
real cloud Supabase project (via the Supabase CLI and Management API) and the real provider API
throughout the build — every bug documented in this README and in the plan's "what actually
happened" notes was found by actually running the thing against real data and real infrastructure,
not by inspection alone.
