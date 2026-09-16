# campaign-portal

Velocity Growth client campaign portal — a take-home build. Work in progress; see
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the full architecture and phased
build order, and [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) for the acceptance criteria every
feature is built against.

> The full README (architecture, deployment, the six logins, AI tools used) lands in the final
> phase. This is a working stub for anyone building against the repo in the meantime.

## Getting started

```bash
npm install
npm run profile   # regenerates docs/DATA_FINDINGS.md from seed/, verifying seed integrity first
npm run gate      # typecheck, lint, dependency rules, coverage, integration tests, mutation testing
```

Real Supabase project access (needed for `tests/integration/**` and any `scripts/*.ts` that talks
to the live project) needs `.env.local` and `apps/web/.env.local` — both gitignored, not included
here. See `docs/MANUAL_SETUP.md` for what's already provisioned and what's still outstanding.

## Layout

```
packages/domain/   pure TypeScript domain logic — import validation, metric definitions,
                    event precedence. No framework imports (enforced by .dependency-cruiser.cjs).
apps/web/           Vite + React + TypeScript SPA.
supabase/            migrations and Edge Functions (added from Phase 3 onward).
seed/                the case study's seed CSVs, hash-verified by scripts/profile-seed.ts.
docs/                the implementation plan, acceptance criteria, and generated data findings.
tests/integration/   real-Supabase integration tests (added from Phase 3 onward).
```

## Quality gate

`npm run gate` chains: `typecheck` → `lint` → `depcruise` → `test:coverage` → `test:integration` →
`mutation`. Thresholds live in `vitest.config.ts` (coverage) and `stryker.conf.json` (mutation) —
see `docs/IMPLEMENTATION_PLAN.md` §7.4 for the reasoning behind each one. `npm run
check:ac-coverage` verifies every ID in `docs/ACCEPTANCE.md` is referenced by a test; it becomes a
blocking `gate` step in the final phase, once the full feature set (and so the full AC set) exists
— run it standalone before then to see real progress.

`tests/integration/**` runs against the real cloud Supabase project (no local Docker — see
`docs/IMPLEMENTATION_PLAN.md` §7.1's "Testing strategy — deviation") and is read-only by design.
It skips gracefully (not a failure) without `docs/CREDENTIALS.local.json`, which only exists on a
machine that's run `scripts/provision-users.ts` against the real project.
