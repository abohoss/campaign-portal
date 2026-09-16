-- Applied automatically by `supabase db reset`. Seeds the three brands with their real timezone
-- and brand_code (docs/IMPLEMENTATION_PLAN.md §2.9 — derived from send_local_time - sent_at_utc
-- across every campaign row and verified by scripts/profile-seed.ts).
--
-- The six test users and their memberships are NOT seeded here — creating an auth.users row
-- correctly (password hashing, confirmed email, etc.) needs the GoTrue admin API, not raw SQL.
-- See tests/helpers/supabase.ts's ensureSeedUsers(), called once per test run.

insert into public.brands (slug, name, country, timezone, brand_code) values
  ('kilele',    'Kilele Rides',      'KE', 'Africa/Nairobi',       'KILELE'),
  ('karoo',     'Karoo Coaches',     'ZA', 'Africa/Johannesburg',  'KAROO'),
  ('marrakech', 'Marrakech Express', 'MA', 'Africa/Casablanca',    'MARRAKECH')
on conflict (slug) do nothing;
