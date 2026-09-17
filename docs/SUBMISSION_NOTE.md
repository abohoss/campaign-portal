# Submission note

**What I tried to break before sending it.** Signed in as all six real accounts directly against
PostgREST with the anon key and read every table checking for cross-brand rows. Fired 20 real
simultaneous `confirm_send` calls at one draft against the live project — exactly one approved.
Tested Google OAuth sign-in from the deployed Vercel app with the configured allowlisted accounts.
Probed the real messaging provider (`docs/PROVIDER_PROBE.md`) and found it leaks a real
cross-tenant event into an unrelated batch's poll response; fixed `ingest_provider_event` to
resolve every recipient scoped to the send being synced, not just by id. Threw a malformed,
wrong-length share token at `share-view` and confirmed it fails exactly like a wrong password
(401), never a 500 that would tell an attacker which check it failed. Re-imported every seed file
twice.

**Where the data-isolation guarantee lives.** `supabase/migrations/0003_rls_policies.sql`,
`public.authorize()` — one function every RLS policy on every tenant table delegates to.

**The number I am least sure about.** Delivery rate for historical campaigns. The engagement log
has no `delivered` events for seed-era campaigns, so that figure only comes from
`reported_delivered` in the brand's own export — and 6 of 46 Kilele campaigns report more opens
than deliveries in that same export. I show both figures side by side, flagged, rather than
silently reconciling them.

**What isn't finished.** No Playwright E2E and no dedicated mobile-layout pass beyond the
responsive Tailwind classes used throughout (both on the plan's own cut list). `send-worker` and
`sync-events` are deployed and their RPCs are proven correct against the live project, but a full
send was never run through the real provider end-to-end inside this session — the provider probe
(hard-capped at 2 synthetic recipients) is the only real traffic sent to it.
