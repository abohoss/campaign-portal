# Isolation break-check (AC-ISO-01, AC-ISO-07)

> **Testing-strategy note.** This document originally planned to prove isolation by writing
> throwaway auth users and fixture rows into a database via automated tests, then deliberately
> breaking RLS and showing the tests fail. That approach was replaced: local Docker Supabase was
> unusable in the build environment (a disk-full crash corrupted Docker Desktop's WSL state
> beyond a quick recovery), and the decision was made not to have any automated process write to
> or mutate the real cloud Supabase project this build submits from. See
> `docs/IMPLEMENTATION_PLAN.md` §7.1 "Testing strategy — deviation" for the full reasoning.
>
> What replaced it: `scripts/verify-rls.ts`, a **read-only** script that queries the real linked
> project's catalog (`pg_class`, `pg_policies`) via `supabase db query --linked` — the Management
> API, not a raw Postgres connection — and asserts every tenant table has RLS enabled and forced,
> and every SELECT policy actually calls `public.authorize(...)` (with one documented, correct
> exception: `memberships`, which is scoped by `user_id = auth.uid()` directly, since
> `authorize()` itself queries `memberships` and using it there would be circular).

## Current evidence (read-only, captured against the real project)

Run with `npm run verify:rls` (needs `SUPABASE_ACCESS_TOKEN` in the current shell's environment —
see the script's header comment for the Windows registry-env-var gotcha on this machine).

```
$ npm run verify:rls

Checked 6 table(s) in public schema on the linked project:

  allowed_emails         RLS✓  FORCED✓  0 policies  no SELECT policy
  brands                 RLS✓  FORCED✓  1 policy  calls authorize()✓
  campaigns              RLS✓  FORCED✓  3 policies  calls authorize()✓
  contacts               RLS✓  FORCED✓  3 policies  calls authorize()✓
  engagement_events      RLS✓  FORCED✓  3 policies  calls authorize()✓
  memberships            RLS✓  FORCED✓  1 policy  documented exception: scoped directly by
                          `user_id = auth.uid()` — using authorize() here would be circular,
                          since authorize() itself queries memberships

All tables: RLS enabled, forced, and every SELECT policy calls authorize(). ✅
```

Captured: 2026-09-16, immediately after `supabase db push` applied migrations `0001`–`0004` to
project `dkzfernckoybcnwoxrbu` for the first time. Re-run after every migration that touches RLS
and re-paste the output above.

## What this does and doesn't prove

- **Proves**: the structural guarantee is live on the actual project right now — RLS is not just
  declared in a migration file, it is enabled and forced on every table, and the policy
  definitions genuinely reference `authorize()` rather than something weaker.
- **Update (Phase 4): the behavioural proof below landed.** Five of six real accounts are now
  provisioned (`docs/MANUAL_SETUP.md`), so `tests/integration/auth.test.ts` signs in as each with
  the real anon key and asserts zero foreign-brand rows come back from every brand-scoped table —
  genuinely proving AC-ISO-02, not just its structural precondition. Still read-only, still no
  automated write to the real project. What's *still* not proven here: cross-brand **write**
  rejection (AC-ISO-03) and the membership self-insert rejection (AC-ISO-05) — both would leave no
  residue even on success, but reinterpreting the "no writes" decision to include those felt like
  the wrong call to make unilaterally; left for once a UI exists to click through manually
  (Phase 6+), matching how the brief's own grading process does it ("we'll sign in as each
  user... and make requests we expect to be turned down").

## Manual break-check (optional, NOT performed automatically, run deliberately if you want the evidence)

This still requires the same discipline as before: run it at a moment you control, on the real
project, and restore it immediately afterward. Because it mutates the schema even briefly, it is
never run by an agent or a CI job on its own initiative — only by a human, on demand.

```sql
-- 1. Un-force RLS on contacts, then re-run `npm run verify:rls` — expect contacts to show FORCED✗.
alter table public.contacts no force row level security;

-- 2. Restore immediately:
alter table public.contacts force row level security;

-- 3. Weaken authorize() to prove the single-point-of-failure design, then re-run verify:rls —
--    expect every table's authorize() check to still say "calls authorize()✓" (the TEXT of the
--    policy is unchanged), which is exactly why this script checks the policy definition and NOT
--    runtime behaviour: it demonstrates verify:rls's own blind spot. Proving THIS specific break
--    needs the behavioural (signed-in-user) test from Phase 4, not this script.

-- 4. Confirm restored:
select relforcerowsecurity from pg_class where relname = 'contacts' and relnamespace = 'public'::regnamespace;
-- must return true
```

Run via `npx supabase db query --linked -f <path-to-a-.sql-file>` (inline SQL with special
characters like `%` can get mangled in transport — see `scripts/verify-rls.ts`'s header comment).
