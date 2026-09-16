# Manual setup — live tracking

Tracks docs/IMPLEMENTATION_PLAN.md §9 against what's actually been done. Update as each item
lands; don't let this drift from reality.

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Supabase cloud project | ✅ Done (Phase 3) | `dkzfernckoybcnwoxrbu`, org `ngqaviulocvfpukhomwe`, `eu-central-1`. Migrations `0001`–`0004` + `supabase/seed.sql` applied. |
| 2 | Six Google-capable accounts | 🟡 In progress — **5 of 6** | See below. Sixth pending. |
| 3 | Google OAuth client | ⬜ Not started | Needs the redirect URI, which needs the project (done) — can start anytime. |
| 4 | Disable public signup | ⬜ Not started | Phase 4. |
| 5 | Register the auth hook | ⬜ Not started | Phase 4. |
| 6 | Supabase secrets (`PROVIDER_API_KEY` etc.) | ⬜ Not started | Provider key is in hand (`.env.local`, gitignored) but not yet pushed to `supabase secrets` — do this in Phase 7 when the send worker needs it, not before (no reason for an Edge Function secret to exist before an Edge Function reads it). |
| 7 | Storage bucket (`imports`) | ⬜ Not started | Phase 5. |
| 8 | Vercel env vars | ⬜ Not started | Phase 11 (or whenever first deployed). |
| 9 | pg_cron schedules | ⬜ Not started | Phase 5 (import worker) / Phase 8 (event sync). |
| 10 | Set and record six passwords | 🟡 Pending accounts | Can't finish until all six accounts exist. |

## The six accounts

Plus-addressing does not work with Google (docs/IMPLEMENTATION_PLAN.md §9 #1) — these are six
genuinely separate Google accounts, not one address with suffixes.

| Email | Status | Brand | Role |
|---|---|---|---|
| ahmedhosamabbass@gmail.com | provided | _unassigned_ | _unassigned_ |
| ahmedhossamabb2003@gmail.com | provided | _unassigned_ | _unassigned_ |
| magichand093@gmail.com | provided | _unassigned_ | _unassigned_ |
| radwanahmed0777@gmail.com | provided | _unassigned_ | _unassigned_ |
| eldeebahmed0101@gmail.com | provided | _unassigned_ | _unassigned_ |
| _(sixth pending)_ | not yet provided | — | — |

Brand/role assignment (each brand gets one owner + one analyst) is deferred until all six exist —
no reason to lock it in one short, and it costs nothing to decide later. Default plan absent other
preference: assign in the order given, two per brand, first of each pair as owner:

```
Kilele    owner:   ahmedhosamabbass@gmail.com
Kilele    analyst: ahmedhossamabb2003@gmail.com
Karoo     owner:   magichand093@gmail.com
Karoo     analyst: radwanahmed0777@gmail.com
Marrakech owner:   eldeebahmed0101@gmail.com
Marrakech analyst: (sixth)
```

Say the word if a different pairing is wanted before Phase 4 wires up `allowed_emails` — trivial to
change now, a small migration edit once seeded for real.

## Secrets inventory (never committed — tracked here by name only)

| Name | Where it lives | Used by |
|---|---|---|
| `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` | root Node scripts (migrations, admin tasks) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `apps/web/.env.local` | the SPA (anon key only, by design) |
| `PROVIDER_BASE_URL`, `PROVIDER_API_KEY` | `.env.local` | Phase 7 send worker, Phase 3.3 probe script — not used yet |
| `SUPABASE_ACCESS_TOKEN` | Windows User-scope env var (registry), not a repo file | `supabase` CLI, this machine only |
| `SUPABASE_DB_PASSWORD` | Windows User-scope env var (registry), not a repo file | project creation only; not needed day-to-day since `db push`/`db query --linked` go through the Management API |
| Six account passwords | not yet set | needed for submission email once accounts exist |
