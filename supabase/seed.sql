-- Applied via `supabase db query --linked -f supabase/seed.sql` (no local Docker — see the
-- "Testing strategy — deviation" note in docs/IMPLEMENTATION_PLAN.md §7.1). Seeds the three
-- brands with their real timezone and brand_code (§2.9 — derived from send_local_time -
-- sent_at_utc across every campaign row and verified by scripts/profile-seed.ts), and the
-- allowlist entries for the real six accounts (docs/MANUAL_SETUP.md tracks their status).
--
-- The auth.users rows themselves are NOT created here — real password hashing and email
-- confirmation need the GoTrue Admin API, not raw SQL. See scripts/provision-users.ts.

insert into public.brands (slug, name, country, timezone, brand_code) values
  ('kilele',    'Kilele Rides',      'KE', 'Africa/Nairobi',       'KILELE'),
  ('karoo',     'Karoo Coaches',     'ZA', 'Africa/Johannesburg',  'KAROO'),
  ('marrakech', 'Marrakech Express', 'MA', 'Africa/Casablanca',    'MARRAKECH')
on conflict (slug) do nothing;

-- Five of six real accounts (docs/MANUAL_SETUP.md — sixth pending, added here once provided).
-- Re-running this file is safe: `on conflict (email) do update` lets a reassignment (e.g.
-- changing who owns which brand) just mean editing this file and re-applying it.
insert into public.allowed_emails (email, brand_id, role)
values
  ('ahmedhosamabbass@gmail.com',   (select id from public.brands where slug = 'kilele'),    'owner'),
  ('ahmedhossamabb2003@gmail.com', (select id from public.brands where slug = 'kilele'),    'analyst'),
  ('magichand093@gmail.com',       (select id from public.brands where slug = 'karoo'),     'owner'),
  ('radwanahmed0777@gmail.com',    (select id from public.brands where slug = 'karoo'),     'analyst'),
  ('eldeebahmed0101@gmail.com',    (select id from public.brands where slug = 'marrakech'), 'owner')
on conflict (email) do update set brand_id = excluded.brand_id, role = excluded.role;
