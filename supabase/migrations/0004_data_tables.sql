-- Phase 3 (docs/IMPLEMENTATION_PLAN.md §5.4): tenant data tables. Each table gets the isolation
-- pattern from 0003_rls_policies.sql applied immediately after its own creation — RLS is never
-- bolted on afterward as a separate step, so there's no window where a new table exists without
-- it. This is also what the catalog test (AC-ISO-01) would catch if a future table skipped it.
--
-- engagement_events.send_id (references public.sends) is added by 0007_events.sql once the send
-- state machine (0006_sends.sql, Phase 7) exists — it can't be created here, before that table
-- exists. Every other column matches docs/IMPLEMENTATION_PLAN.md §5.4 in full.

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  external_id text not null check (external_id ~ '^CT-\d+$'),
  full_name text,
  email citext,                                    -- normalised: btrim -> lower (see packages/domain normalizeEmail)
  email_valid boolean not null default false,
  phone_raw text,
  phone_e164 text,
  country char(2),
  city text,
  signup_at timestamptz,
  status public.contact_status not null default 'active',
  consent_marketing boolean,                        -- NULL = unknown, and unknown is NOT contactable (§6)
  deleted_at timestamptz,
  suppressed_until timestamptz,
  notes text check (notes is null or length(notes) <= 1000),
  source_import_run_id uuid,                         -- FK added by 0005_import.sql once import_runs exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_brand_external_uniq unique (brand_id, external_id),
  constraint contacts_signup_not_future check (signup_at is null or signup_at <= now() + interval '1 day')
);
create index contacts_brand_signup_idx on public.contacts (brand_id, signup_at desc);
create index contacts_brand_status_idx on public.contacts (brand_id, status);
create index contacts_brand_email_idx  on public.contacts (brand_id, email);
create index contacts_keyset_idx       on public.contacts (brand_id, created_at desc, id desc);
-- Partial index backing the "contactable" metric (§6) — matches that WHERE clause exactly so the
-- planner can use it directly instead of scanning every row per dashboard load.
create index contacts_contactable_idx on public.contacts (brand_id)
  where deleted_at is null
    and consent_marketing is true
    and status in ('active', 'pending');

alter table public.contacts enable row level security;
alter table public.contacts force row level security;

create policy contacts_select on public.contacts
  for select to authenticated
  using (public.authorize(brand_id));
create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (public.authorize(brand_id, 'owner'));
create policy contacts_update on public.contacts
  for update to authenticated
  using (public.authorize(brand_id, 'owner'))
  with check (public.authorize(brand_id, 'owner'));
-- no delete policy: deletes denied by default for every role reachable through PostgREST.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  external_id text not null,
  name text not null,
  channel text not null check (channel in ('email', 'sms')),
  target_country char(2),
  reported_sent int,
  reported_delivered int,
  reported_bounced int,
  reported_opens int,
  reported_clicks int,
  spend numeric(12, 2),
  sent_at timestamptz,
  parent_external_id text,
  created_at timestamptz not null default now(),
  constraint campaigns_brand_external_uniq unique (brand_id, external_id)
);
create index campaigns_brand_idx on public.campaigns (brand_id);

alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;

create policy campaigns_select on public.campaigns
  for select to authenticated
  using (public.authorize(brand_id));
create policy campaigns_insert on public.campaigns
  for insert to authenticated
  with check (public.authorize(brand_id, 'owner'));
create policy campaigns_update on public.campaigns
  for update to authenticated
  using (public.authorize(brand_id, 'owner'))
  with check (public.authorize(brand_id, 'owner'));

create table public.engagement_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  provider_event_id text not null,
  event_type public.event_type not null,
  channel text,
  occurred_at timestamptz not null,
  source public.event_source not null,
  ingested_at timestamptz not null default now(),
  constraint events_brand_provider_uniq unique (brand_id, provider_event_id)  -- dedupe lives here (AC-EVT-02)
);
create index events_campaign_type_idx on public.engagement_events (campaign_id, event_type);
create index events_contact_idx       on public.engagement_events (contact_id);
create index events_brand_time_idx    on public.engagement_events (brand_id, occurred_at desc);

alter table public.engagement_events enable row level security;
alter table public.engagement_events force row level security;

create policy engagement_events_select on public.engagement_events
  for select to authenticated
  using (public.authorize(brand_id));
create policy engagement_events_insert on public.engagement_events
  for insert to authenticated
  with check (public.authorize(brand_id, 'owner'));
create policy engagement_events_update on public.engagement_events
  for update to authenticated
  using (public.authorize(brand_id, 'owner'))
  with check (public.authorize(brand_id, 'owner'));
