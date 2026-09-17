-- schema.sql — the full, real schema of the live Supabase project, exported by concatenating
-- supabase/migrations/*.sql in the exact order they were applied (0001 through 0017) via
-- `supabase db push`. This build never had a local Postgres available (a Docker-desktop crash
-- corrupted WSL state early in the build — see docs/IMPLEMENTATION_PLAN.md Phase 3's notes —
-- and the standing decision from then on was to develop against the real cloud project only),
-- so this is a concatenation of the applied migrations rather than a pg_dump. It is a more
-- faithful record of what actually ran than a dump would be: every statement below is exactly
-- what Postgres executed, in order, including the comments explaining why.
--
-- The isolation guarantee lives in 0003_rls_policies.sql, in public.authorize() at the top of
-- that section below.

-- ============================================================================
-- 0001_extensions.sql
-- ============================================================================
-- Phase 3 (docs/IMPLEMENTATION_PLAN.md §5.1): extensions and enums shared across every later
-- migration. Nothing here is brand-scoped — no RLS applies to extensions or types.

create extension if not exists pgcrypto;   -- gen_random_uuid(), crypt()/gen_salt() for share-link passwords
create extension if not exists citext;     -- case-insensitive email columns
create extension if not exists pg_cron;    -- event sync + import worker scheduling (Phase 5/8)
create extension if not exists pg_net;     -- async HTTP from pg_cron jobs (Phase 8)

create type public.brand_role      as enum ('owner', 'analyst');
create type public.contact_status  as enum ('active', 'pending', 'unsubscribed', 'bounced');
create type public.event_type      as enum ('delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'complained');
create type public.event_source    as enum ('seed', 'provider');
create type public.send_status     as enum ('draft', 'approved', 'sending', 'sent', 'failed', 'cancelled');
create type public.chunk_state     as enum ('pending', 'in_flight', 'done', 'failed');
create type public.recipient_state as enum ('pending', 'sent', 'rejected', 'failed');
create type public.import_status   as enum ('queued', 'running', 'succeeded', 'partial', 'failed');
create type public.import_kind     as enum ('contacts', 'campaigns');
create type public.severity        as enum ('error', 'warning');

-- ============================================================================
-- 0002_core_tables.sql
-- ============================================================================
-- Phase 3 (docs/IMPLEMENTATION_PLAN.md §5.2): tenancy tables. RLS for these lands in
-- 0003_rls_policies.sql, alongside the public.authorize() helper they're checked against.

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null,
  country char(2) not null,
  timezone text not null,     -- IANA zone: Africa/Nairobi | Africa/Johannesburg | Africa/Casablanca
  brand_code text not null unique check (brand_code = upper(brand_code)),  -- KILELE | KAROO | MARRAKECH
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  role public.brand_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);
create index memberships_brand_idx on public.memberships (brand_id);

-- Auth allowlist consulted by the before-user-created hook (Phase 4). Deliberately gets NO RLS
-- policies at all in 0003 — unreachable by anon and authenticated, service-role/hook only.
create table public.allowed_emails (
  email citext primary key,
  brand_id uuid not null references public.brands (id),
  role public.brand_role not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 0003_rls_policies.sql
-- ============================================================================
-- ============================================================================================
-- THE data-isolation guarantee (docs/IMPLEMENTATION_PLAN.md §5.3, §1 done-rule #2, done-rule #8).
--
-- Every RLS policy in this database — on every tenant table, in every migration, including ones
-- written after whoever reads this has moved on — delegates to this one function. Change this
-- function and you change tenancy for the entire database at once. There is no second way to
-- scope a query to a brand; anyone adding one is doing it wrong.
--
-- SECURITY DEFINER so it can read public.memberships without recursing through memberships' own
-- RLS (a SELECT policy on memberships that itself queried memberships would deadlock the planner).
-- search_path is pinned to '' and every identifier is schema-qualified so this function cannot be
-- tricked by a search_path attack from a role that can create objects in another schema.
--
-- tests/integration/isolation.catalog.test.ts (Phase 3) is the automated proof this holds; the
-- four-step manual break-check in docs/ISOLATION_BREAK_CHECK.md is the proof that removing this
-- guarantee is caught, not silently shipped.
-- ============================================================================================
create or replace function public.authorize(
  p_brand_id uuid,
  p_min_role public.brand_role default 'analyst'
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id  = (select auth.uid())
      and m.brand_id = p_brand_id
      and (p_min_role = 'analyst' or m.role = 'owner')
  );
$$;

revoke all on function public.authorize(uuid, public.brand_role) from public;
grant execute on function public.authorize(uuid, public.brand_role) to authenticated;

comment on function public.authorize is
  'THE isolation guarantee. Every RLS policy on every tenant table calls this. '
  'See docs/IMPLEMENTATION_PLAN.md §5.3 and docs/ISOLATION_BREAK_CHECK.md.';

-- ---------------------------------------------------------------------------------------------
-- brands: a member reads only the brand(s) they belong to. No write policies — brands are seeded
-- by migration/admin, not created by app users; every write is denied by default (default-deny).
-- ---------------------------------------------------------------------------------------------
alter table public.brands enable row level security;
alter table public.brands force row level security;

create policy brands_select on public.brands
  for select to authenticated
  using (public.authorize(id));

-- ---------------------------------------------------------------------------------------------
-- memberships: a user reads only their own membership rows. NO insert/update/delete policy of
-- any kind, for any role — a user can never grant themselves a brand or a role (AC-ISO-05).
-- Memberships are written only by the after-insert trigger on auth.users (Phase 4), which runs
-- with elevated privileges, not through a policy an authenticated user could ever satisfy.
-- ---------------------------------------------------------------------------------------------
alter table public.memberships enable row level security;
alter table public.memberships force row level security;

create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- allowed_emails: consulted only by the before-user-created auth hook and admin tooling, both of
-- which run as a privileged role that bypasses RLS. NO policies at all — unreachable by anon or
-- authenticated, which is the point: this table decides who is even allowed to become a user.
-- ---------------------------------------------------------------------------------------------
alter table public.allowed_emails enable row level security;
alter table public.allowed_emails force row level security;

-- ============================================================================
-- 0004_data_tables.sql
-- ============================================================================
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

-- ============================================================================
-- 0005_import.sql
-- ============================================================================
-- Phase 5 (docs/IMPLEMENTATION_PLAN.md §5.5): import tracking. import_runs is the resumability
-- anchor (chunk_cursor/byte_offset survive a crashed worker); import_errors is what the marketer
-- sees for "the data loads, and the marketer can see what didn't" (done-rule 3).

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind public.import_kind not null,
  filename text not null,
  storage_path text not null,
  file_sha256 text,                    -- identical re-upload is detectable and reported
  status public.import_status not null default 'queued',
  total_rows int, processed_rows int not null default 0,
  inserted_count int not null default 0, updated_count int not null default 0,
  rejected_count int not null default 0, warning_count int not null default 0,
  chunk_cursor int not null default 0,  -- resume point; survives a worker crash
  byte_offset bigint not null default 0,
  detected_encoding text, detected_delimiter text,
  error_summary text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz
);
create index import_runs_brand_idx on public.import_runs (brand_id, created_at desc);

alter table public.import_runs enable row level security;
alter table public.import_runs force row level security;

create policy import_runs_select on public.import_runs
  for select to authenticated
  using (public.authorize(brand_id));
create policy import_runs_insert on public.import_runs
  for insert to authenticated
  with check (public.authorize(brand_id, 'owner'));
-- No update/delete policy for authenticated: only the service-role worker (which bypasses RLS)
-- advances status/chunk_cursor/counts. An owner can start an import; only the worker progresses it.

create table public.import_errors (
  id bigserial primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  row_number int not null,             -- 1-based, matches the file the marketer uploaded
  field text,                          -- null = whole-row rejection
  value_excerpt text check (length(value_excerpt) <= 200),
  reason_code text not null,           -- the §2.10 vocabulary (packages/domain/src/import/types.ts ReasonCode)
  reason text not null,                -- human sentence shown in the UI
  severity public.severity not null default 'error',
  created_at timestamptz not null default now()
);
create index import_errors_run_idx on public.import_errors (import_run_id, row_number);

alter table public.import_errors enable row level security;
alter table public.import_errors force row level security;

create policy import_errors_select on public.import_errors
  for select to authenticated
  using (public.authorize(brand_id));
-- No insert/update/delete policy for authenticated: only the service-role worker writes these.

-- Now that import_runs exists, wire contacts.source_import_run_id to it. This FK was declared
-- as a plain uuid column (no reference) in 0004_data_tables.sql, before import_runs existed —
-- see that migration's header comment.
alter table public.contacts
  add constraint contacts_source_import_run_fk
  foreign key (source_import_run_id) references public.import_runs(id) on delete set null;

-- ============================================================================
-- 0006_sends.sql
-- ============================================================================
-- Phase 7 (docs/IMPLEMENTATION_PLAN.md §5.6): the send state machine. Every table gets RLS
-- enabled+forced immediately, same as every prior migration.
--
-- Deviation from §5.6, found by the real provider probe (docs/PROVIDER_PROBE.md, C2): the plan
-- specced both `events_cursor` (opaque next_cursor) and `last_event_id` (for a `since=<event_id>`
-- fallback). The probe proved `since=<event_id>` doesn't filter anything — it replays the whole
-- page — so `last_event_id` is dead weight that would never be read. Dropped; `events_cursor` is
-- the only cursor this build persists.

create table public.sends (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  status public.send_status not null default 'draft',
  snapshot_count int not null,
  chunk_size int not null default 1000,
  chunks_total int not null,
  chunks_done int not null default 0,
  provider_batch_ids text[] not null default '{}',
  events_cursor text,
  last_synced_at timestamptz,
  created_by uuid not null references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sends_approved_fields check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status <> 'draft' and approved_by is not null and approved_at is not null)
  )
);
create index sends_brand_idx on public.sends (brand_id, created_at desc);

-- AT MOST ONE ACTIVE SEND PER CAMPAIGN — the concurrency guarantee lives partly here, partly in
-- confirm_send's row lock (0009_rpc.sql). Two independent defences, per §10 R4.
create unique index sends_one_active_per_campaign
  on public.sends (campaign_id)
  where status in ('draft', 'approved', 'sending');

alter table public.sends enable row level security;
alter table public.sends force row level security;

create policy sends_select on public.sends
  for select to authenticated
  using (public.authorize(brand_id));
create policy sends_insert on public.sends
  for insert to authenticated
  with check (public.authorize(brand_id, 'owner'));
-- No update policy for authenticated: every status transition goes through confirm_send or the
-- send-worker (service role), never a direct client UPDATE.

-- The frozen recipient snapshot. Historical sends read THIS, never live contacts — approving a
-- send freezes who it went to even if the underlying contacts are edited or deleted afterward
-- (AC-SEND-09).
create table public.send_recipients (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.sends (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  contact_id uuid not null references public.contacts (id),
  external_id text not null,
  email citext,
  chunk_no int not null,
  state public.recipient_state not null default 'pending',
  provider_message_id text,
  rejected_reason text,
  -- Monotonic flags: set-once true => any arrival order, any duplication, same final state.
  has_delivered boolean not null default false,
  has_opened boolean not null default false,
  has_clicked boolean not null default false,
  has_bounced boolean not null default false,
  has_unsubscribed boolean not null default false,
  has_complained boolean not null default false,
  constraint send_recipients_uniq unique (send_id, contact_id)
);
create index send_recipients_chunk_idx on public.send_recipients (send_id, chunk_no);
-- Phase 8's event ingest resolves an incoming event's recipient_id (which this build sets to
-- send_recipients.id, per docs/PROVIDER_PROBE.md's C3 finding) with one indexed lookup here.
create index send_recipients_send_id_idx on public.send_recipients (id, send_id);

alter table public.send_recipients enable row level security;
alter table public.send_recipients force row level security;

create policy send_recipients_select on public.send_recipients
  for select to authenticated
  using (public.authorize(brand_id));
-- No insert/update policy for authenticated: preview_send (owner-checked RPC) and the service-role
-- send-worker/event-ingest are the only writers.

create table public.send_chunks (
  send_id uuid not null references public.sends (id) on delete cascade,
  chunk_no int not null,
  idempotency_key text not null,
  state public.chunk_state not null default 'pending',
  attempts int not null default 0,
  provider_batch_id text,
  accepted_count int,
  rejected_count int,
  request_at timestamptz,
  response_at timestamptz,
  error text,
  primary key (send_id, chunk_no),
  constraint send_chunks_idem_uniq unique (idempotency_key)
);

alter table public.send_chunks enable row level security;
alter table public.send_chunks force row level security;

create policy send_chunks_select on public.send_chunks
  for select to authenticated
  using (exists (select 1 from public.sends s where s.id = send_chunks.send_id and public.authorize(s.brand_id)));
-- No insert/update policy for authenticated: only the service-role send-worker ever writes here.

-- ============================================================================
-- 0007_events.sql
-- ============================================================================
-- Phase 8 (docs/IMPLEMENTATION_PLAN.md §5.7): idempotent, order-independent provider event
-- ingestion. SECURITY DEFINER with an explicit authorize() check, per the lesson learned in
-- Phase 6/7 — not security_invoker.
--
-- Deviation from §5.6/§5.7, found by the real provider probe (docs/PROVIDER_PROBE.md): a single
-- send can dispatch as multiple provider batches (one per chunk, each POST returning its own
-- batch_id — sends.provider_batch_ids is already an array), so a single scalar cursor can't track
-- "where am I in each batch's event stream" for more than one batch. events_cursor is redefined
-- here from `text` to `jsonb`, a map of `{ [batch_id]: next_cursor }`.
--
-- Deviation #2, also from the probe: `since=<event_id>` doesn't work (P3c proved it replays the
-- whole page instead of filtering) — only `next_cursor` does. So there is no last_event_id
-- fallback anywhere in this design; sync-events always pages with next_cursor only.

alter table public.sends alter column events_cursor type jsonb using null;

create table public.provider_events_raw (
  id bigserial primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  send_id uuid references public.sends (id) on delete cascade,
  provider_event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  constraint provider_events_raw_uniq unique (provider_event_id)
);

alter table public.provider_events_raw enable row level security;
alter table public.provider_events_raw force row level security;
create policy provider_events_raw_select on public.provider_events_raw
  for select to authenticated
  using (public.authorize(brand_id));
-- No insert/update policy: only the service-role sync-events function and
-- ingest_provider_events (SECURITY DEFINER) ever write here.

create table public.event_quarantine (
  id bigserial primary key,
  brand_id uuid references public.brands (id) on delete cascade,
  send_id uuid references public.sends (id) on delete cascade,
  provider_event_id text,
  payload jsonb not null,
  reason_code text not null, -- UNKNOWN_RECIPIENT | UNKNOWN_EVENT_TYPE
  reason text not null,
  received_at timestamptz not null default now()
);

alter table public.event_quarantine enable row level security;
alter table public.event_quarantine force row level security;
create policy event_quarantine_select on public.event_quarantine
  for select to authenticated
  using (public.authorize(brand_id));

-- One event at a time (the Edge Function loops and calls this once per event, inside its own
-- transaction each time) — simpler than a jsonb-array batch RPC, and each event's dedupe/resolve/
-- apply/propagate/cursor-advance is already atomic per call, which is all AC-EVT-06 requires: a
-- crash between two events loses nothing, because the one that already committed stays committed
-- and the next sync tick resumes from the persisted cursor, not from event 1 of the page again.
--
-- No authorize() check here, unlike every other SECURITY DEFINER function in this build — this
-- one is granted to service_role only (see below), never to authenticated. There is no signed-in
-- "caller" for authorize() to check against when sync-events (running as service role, on
-- pg_cron's schedule) invokes this — the access boundary is the GRANT itself, which PostgREST
-- never exposes to anon/authenticated at all.
create or replace function public.ingest_provider_event(
  p_send_id uuid,
  p_provider_event_id text,
  p_recipient_id uuid,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_campaign_id uuid;
  v_contact_id uuid;
  v_canonical public.event_type;
  v_inserted_raw boolean;
begin
  select brand_id, campaign_id into v_brand_id, v_campaign_id from public.sends where id = p_send_id;
  if v_brand_id is null then
    raise exception 'send not found' using errcode = 'no_data_found';
  end if;

  insert into public.provider_events_raw (brand_id, send_id, provider_event_id, payload)
  values (v_brand_id, p_send_id, p_provider_event_id, p_payload)
  on conflict (provider_event_id) do nothing;
  get diagnostics v_inserted_raw = row_count;
  if not v_inserted_raw then
    return; -- already processed this exact provider_event_id — dedupe, not an error
  end if;

  -- Resolve the recipient scoped to THIS send — not just any send_recipients row with a matching
  -- id. This is the direct fix for the real cross-tenant leak the probe found (an unrelated event
  -- for a real Karoo contact showed up in a probe batch's own stream): scoping by send_id means a
  -- foreign/forged recipient_id can only ever match a row that genuinely belongs to this send,
  -- which already belongs to one specific brand — there is no code path where a mismatched brand
  -- could be written even if the provider hands back an id belonging to another brand's send.
  select contact_id into v_contact_id
  from public.send_recipients
  where id = p_recipient_id and send_id = p_send_id;

  if v_contact_id is null then
    insert into public.event_quarantine (brand_id, send_id, provider_event_id, payload, reason_code, reason)
    values (v_brand_id, p_send_id, p_provider_event_id, p_payload, 'UNKNOWN_RECIPIENT',
      format('No send_recipients row %s for send %s.', p_recipient_id, p_send_id));
    return;
  end if;

  begin
    v_canonical := p_event_type::public.event_type;
  exception when invalid_text_representation then
    insert into public.event_quarantine (brand_id, send_id, provider_event_id, payload, reason_code, reason)
    values (v_brand_id, p_send_id, p_provider_event_id, p_payload, 'UNKNOWN_EVENT_TYPE',
      format('Unrecognised event_type %L.', p_event_type));
    return;
  end;

  insert into public.engagement_events (brand_id, contact_id, campaign_id, provider_event_id, event_type, occurred_at, source)
  values (v_brand_id, v_contact_id, v_campaign_id, p_provider_event_id, v_canonical, p_occurred_at, 'provider')
  on conflict (brand_id, provider_event_id) do nothing;

  -- Monotonic set-once-true flags: order- and duplicate-independent by construction (see
  -- packages/domain/src/events.ts, proven by events.convergence.prop). "opened" also sets
  -- has_delivered.
  update public.send_recipients
  set
    has_delivered = has_delivered or (v_canonical in ('delivered', 'opened')),
    has_opened = has_opened or (v_canonical = 'opened'),
    has_clicked = has_clicked or (v_canonical = 'clicked'),
    has_bounced = has_bounced or (v_canonical = 'bounced'),
    has_unsubscribed = has_unsubscribed or (v_canonical = 'unsubscribed'),
    has_complained = has_complained or (v_canonical = 'complained')
  where id = p_recipient_id;

  -- Propagation is sticky by construction too: only bounced/unsubscribed ever touch contacts, and
  -- once written, no other event type in this function ever reverts them.
  if v_canonical = 'bounced' then
    update public.contacts set status = 'bounced' where id = v_contact_id;
  elsif v_canonical = 'unsubscribed' then
    update public.contacts set status = 'unsubscribed', consent_marketing = false where id = v_contact_id;
  end if;
end;
$$;
revoke all on function public.ingest_provider_event(uuid, text, uuid, text, timestamptz, jsonb) from public;
grant execute on function public.ingest_provider_event(uuid, text, uuid, text, timestamptz, jsonb) to service_role;

-- Advances one batch's cursor within a send's events_cursor map — called once per sync-events
-- invocation per batch, in the SAME transaction as that batch's last successfully ingested event
-- would have been (the Edge Function calls this right after its ingest loop for that batch
-- completes), so a crash before this runs just means the next tick re-fetches from the old cursor
-- and re-ingests already-deduped events — safe, never lossy. service_role only, same reasoning as
-- ingest_provider_event above.
create or replace function public.advance_events_cursor(p_send_id uuid, p_batch_id text, p_next_cursor text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
begin
  select brand_id into v_brand_id from public.sends where id = p_send_id;
  if v_brand_id is null then
    raise exception 'send not found' using errcode = 'no_data_found';
  end if;
  update public.sends
  set
    events_cursor = coalesce(events_cursor, '{}'::jsonb) || jsonb_build_object(p_batch_id, p_next_cursor),
    last_synced_at = now()
  where id = p_send_id;
end;
$$;
revoke all on function public.advance_events_cursor(uuid, text, text) from public;
grant execute on function public.advance_events_cursor(uuid, text, text) to service_role;

-- ============================================================================
-- 0008_share.sql
-- ============================================================================
-- Phase 9 (docs/IMPLEMENTATION_PLAN.md §5.8): password-protected, rate-limited public campaign
-- results. share_links gets enable+force RLS and NO POLICIES AT ALL — anon and authenticated can
-- never SELECT it directly; the only access path is public.share_view below, SECURITY DEFINER,
-- granted to anon specifically (the one function in this whole build anon can call).

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  token_sha256 bytea not null unique,
  password_hash text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz
);
alter table public.share_links enable row level security;
alter table public.share_links force row level security;

create table public.share_link_attempts (
  id bigserial primary key,
  token_sha256 bytea,
  ip_hash text,
  ok boolean not null,
  attempted_at timestamptz not null default now()
);
create index share_attempts_window_idx on public.share_link_attempts (token_sha256, attempted_at desc);
create index share_attempts_ip_idx on public.share_link_attempts (ip_hash, attempted_at desc);
alter table public.share_link_attempts enable row level security;
alter table public.share_link_attempts force row level security;
-- No policies on either table — everything below goes through SECURITY DEFINER functions.

-- Owner-only. Returns the plaintext token exactly once, at creation — only its SHA-256 is ever
-- stored. 32 random bytes (256 bits), base64url-encoded, well above the 128-bit floor.
create or replace function public.create_share_link(p_campaign_id uuid, p_password text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_token bytea;
  v_token_text text;
begin
  select brand_id into v_brand_id from public.campaigns where id = p_campaign_id;
  if v_brand_id is null then
    raise exception 'campaign not found' using errcode = 'no_data_found';
  end if;
  if not public.authorize(v_brand_id, 'owner') then
    raise insufficient_privilege using message = 'only an owner can create a share link';
  end if;
  if length(p_password) < 8 then
    raise exception 'password must be at least 8 characters' using errcode = 'invalid_parameter_value';
  end if;

  v_token := extensions.gen_random_bytes(32);
  v_token_text := translate(encode(v_token, 'base64'), '+/=', '-_');

  insert into public.share_links (brand_id, campaign_id, token_sha256, password_hash, created_by)
  values (v_brand_id, p_campaign_id, extensions.digest(v_token, 'sha256'), extensions.crypt(p_password, extensions.gen_salt('bf', 12)), (select auth.uid()));

  return v_token_text;
end;
$$;
revoke all on function public.create_share_link(uuid, text) from public;
grant execute on function public.create_share_link(uuid, text) to authenticated;

create or replace function public.revoke_share_link(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
begin
  select brand_id into v_brand_id from public.share_links where id = p_id;
  if v_brand_id is null then
    raise exception 'share link not found' using errcode = 'no_data_found';
  end if;
  if not public.authorize(v_brand_id, 'owner') then
    raise insufficient_privilege using message = 'only an owner can revoke a share link';
  end if;
  update public.share_links set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;
revoke all on function public.revoke_share_link(uuid) from public;
grant execute on function public.revoke_share_link(uuid) to authenticated;

-- The one function anon can call. Rate limited per token AND per (hashed) IP; identical error
-- shape for "no such token", "wrong password", "revoked" and "rate limited" — a stranger probing
-- this endpoint learns nothing about which failure mode they hit. Every attempt is logged before
-- the result is decided, so the rate limit itself can't be bypassed by a crash/retry race.
--
-- Takes the token hash as plain hex TEXT, not bytea. PostgREST's RPC parameter serialisation
-- doesn't accept a raw `\x...` bytea literal the way a psql session would — the Edge Function
-- would need to construct exactly the driver-internal wire format, which isn't documented and
-- differed from what a JSON string parameter round-trips as (found by an actual failing call
-- through the deployed function, not by inspection). A hex string decoded server-side with
-- decode(..., 'hex') is unambiguous over JSON and has one obvious representation.
drop function if exists public.share_view(bytea, text, text);
create or replace function public.share_view(p_token_sha256_hex text, p_password text, p_ip_hash text)
returns table (
  campaign_name text,
  channel text,
  sent_at timestamptz,
  reported_sent int,
  reported_delivered int,
  reported_bounced int,
  reported_opens int,
  unique_opens bigint,
  open_rate numeric,
  bounce_rate numeric
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_link public.share_links;
  v_recent_attempts int;
  v_ok boolean := false;
  v_token_sha256 bytea;
  -- A real bcrypt hash of a value nobody will ever type, so a missing token still pays the same
  -- crypt() cost as a real one — the point is constant-shaped work, not a valid comparison.
  v_dummy_hash constant text := '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0drjOFB1TW1gvUiRCqR0h6QGpwoZTgS';
begin
  begin
    v_token_sha256 := decode(p_token_sha256_hex, 'hex');
  exception when others then
    return; -- malformed hex — same empty result as every other failure mode, never a 500
  end;

  select count(*) into v_recent_attempts
  from public.share_link_attempts
  where attempted_at > now() - interval '10 minutes'
    and (token_sha256 = v_token_sha256 or ip_hash = p_ip_hash);
  if v_recent_attempts >= 20 then
    return; -- rate limited — same empty result as every other failure mode
  end if;

  select * into v_link from public.share_links where token_sha256 = v_token_sha256;

  if v_link.id is null then
    perform extensions.crypt(p_password, v_dummy_hash); -- dummy compare, constant-shaped timing
    insert into public.share_link_attempts (token_sha256, ip_hash, ok) values (v_token_sha256, p_ip_hash, false);
    return;
  end if;

  v_ok := extensions.crypt(p_password, v_link.password_hash) = v_link.password_hash
    and v_link.revoked_at is null
    and (v_link.expires_at is null or v_link.expires_at > now());

  insert into public.share_link_attempts (token_sha256, ip_hash, ok) values (v_token_sha256, p_ip_hash, v_ok);
  if not v_ok then
    return;
  end if;

  update public.share_links set view_count = view_count + 1, last_viewed_at = now() where id = v_link.id;

  return query
    select
      c.name,
      c.channel,
      c.sent_at,
      c.reported_sent,
      c.reported_delivered,
      c.reported_bounced,
      c.reported_opens,
      coalesce(e.unique_opens, 0),
      case when coalesce(c.reported_delivered, 0) > 0
        then round(coalesce(e.unique_opens, 0)::numeric / c.reported_delivered, 4)
        else null end,
      case when coalesce(c.reported_sent, 0) > 0
        then round(coalesce(c.reported_bounced, 0)::numeric / c.reported_sent, 4)
        else null end
    from public.campaigns c
    left join (
      select engagement_events.campaign_id, count(distinct contact_id) filter (where event_type = 'opened') as unique_opens
      from public.engagement_events
      where campaign_id = v_link.campaign_id
      group by engagement_events.campaign_id
    ) e on e.campaign_id = c.id
    where c.id = v_link.campaign_id;
end;
$$;
revoke all on function public.share_view(text, text, text) from public;
grant execute on function public.share_view(text, text, text) to anon;

-- ============================================================================
-- 0009_rpc.sql
-- ============================================================================
-- Phase 7 (docs/IMPLEMENTATION_PLAN.md §5.9): preview_send / confirm_send. Both SECURITY DEFINER
-- (per the Phase 6 correction — see 0010_metrics.sql's header comment for why security_invoker was
-- the wrong default), each re-checking authorize() itself since SECURITY DEFINER bypasses RLS.

-- Freeze the audience and its chunk plan. Idempotent: re-calling for a campaign that already has a
-- draft returns that same draft's id/count rather than creating a second one (the partial unique
-- index sends_one_active_per_campaign would reject a second row anyway, but this makes the
-- "preview again before confirming" path a clean no-op instead of an error).
create or replace function public.preview_send(p_campaign_id uuid)
returns table (send_id uuid, recipient_count int)
language plpgsql security definer
set search_path = ''
-- Freezing Kilele's ~50k-contact audience means one SELECT count(*) plus one INSERT ... SELECT of
-- that many rows, and the INSERT alone fires 3 FK-validation triggers (send_id/brand_id/
-- contact_id) once per row — measured at ~4.7s via EXPLAIN (ANALYZE, BUFFERS) against the live
-- project when it was otherwise idle, close enough to the `authenticated` role's 8s
-- statement_timeout that it genuinely timed out (57014) in a real integration test run. Under
-- this session's own sustained load (many concurrent real-project test runs back to back), the
-- same call measured 25-28s — free-tier compute is shared and finite, and heavy testing is
-- exactly the situation this headroom needs to survive. 45s matches the DEADLINE_MS already used
-- by import-worker/send-worker for the same class of "big-brand-scale, deliberate, infrequent
-- action" work. A function-scoped SET (reverted automatically when the call returns, unlike a
-- role-wide change) keeps this scoped to preview_send alone.
set statement_timeout = '45s'
as $$
declare
  v_brand_id uuid;
  v_send_id uuid;
  v_count int;
  v_chunk_size constant int := 1000;
  v_chunks_total int;
begin
  select brand_id into v_brand_id from public.campaigns where id = p_campaign_id;
  if v_brand_id is null then
    raise exception 'campaign not found' using errcode = 'no_data_found';
  end if;
  if not public.authorize(v_brand_id, 'owner') then
    raise insufficient_privilege using message = 'only an owner can preview a send';
  end if;

  select s.id, s.snapshot_count into v_send_id, v_count
  from public.sends s
  where s.campaign_id = p_campaign_id and s.status = 'draft';

  if v_send_id is not null then
    return query select v_send_id, v_count;
    return;
  end if;

  -- The "contactable" filter here matches §6/packages/domain/src/metrics.ts's isContactable
  -- exactly (deleted, consent, status, email, suppression) — repeated in the count and the insert
  -- below rather than a temp table, since a preview should be a light read, not schema DDL.
  select count(*) into v_count
  from public.contacts c
  where c.brand_id = v_brand_id
    and c.deleted_at is null
    and c.consent_marketing is true
    and c.status in ('active', 'pending')
    and c.email is not null
    and c.email_valid
    and (c.suppressed_until is null or c.suppressed_until <= now());

  v_chunks_total := greatest(1, ceil(v_count::numeric / v_chunk_size)::int);

  insert into public.sends (brand_id, campaign_id, snapshot_count, chunk_size, chunks_total, created_by)
  values (v_brand_id, p_campaign_id, v_count, v_chunk_size, v_chunks_total, (select auth.uid()))
  returning id into v_send_id;

  insert into public.send_recipients (send_id, brand_id, contact_id, external_id, email, chunk_no)
  select
    v_send_id, v_brand_id, c.id, c.external_id, c.email,
    ((row_number() over (order by c.id) - 1) / v_chunk_size)::int
  from public.contacts c
  where c.brand_id = v_brand_id
    and c.deleted_at is null
    and c.consent_marketing is true
    and c.status in ('active', 'pending')
    and c.email is not null
    and c.email_valid
    and (c.suppressed_until is null or c.suppressed_until <= now());

  insert into public.send_chunks (send_id, chunk_no, idempotency_key)
  select v_send_id, gs, v_send_id::text || ':' || gs
  from generate_series(0, v_chunks_total - 1) as gs;

  return query select v_send_id, v_count;
end;
$$;
revoke all on function public.preview_send(uuid) from public;
grant execute on function public.preview_send(uuid) to authenticated;

-- Atomically approve. FOR UPDATE first (serialises concurrent confirms on the SAME row), then
-- role, then status, then the count the screen showed — in that order. Two concurrent calls with
-- the same send_id: exactly one returns successfully, the other raises before any write.
create or replace function public.confirm_send(p_send_id uuid, p_expected_count int)
returns public.sends
language plpgsql security definer
set search_path = ''
as $$
declare
  v_send public.sends;
begin
  select * into v_send from public.sends where id = p_send_id for update;
  if v_send.id is null then
    raise exception 'send not found' using errcode = 'no_data_found';
  end if;

  if not public.authorize(v_send.brand_id, 'owner') then
    raise insufficient_privilege using message = 'only an owner can confirm a send';
  end if;
  if v_send.status <> 'draft' then
    raise exception 'send_already_confirmed' using errcode = 'invalid_parameter_value';
  end if;
  if v_send.snapshot_count <> p_expected_count then
    raise exception 'count_changed' using errcode = 'invalid_parameter_value';
  end if;

  update public.sends
    set status = 'approved', approved_by = (select auth.uid()), approved_at = now()
    where id = p_send_id
    returning * into v_send;

  return v_send;
end;
$$;
revoke all on function public.confirm_send(uuid, int) from public;
grant execute on function public.confirm_send(uuid, int) to authenticated;

-- ============================================================================
-- 0010_metrics.sql
-- ============================================================================
-- Phase 6 (docs/IMPLEMENTATION_PLAN.md §5.10/§6): dashboard, contacts and campaigns metrics.
-- Every figure a screen renders comes from here, never from counting rows fetched to the client
-- (PostgREST truncates at 1000 rows regardless — see the ESLint rule in apps/web's config).
--
-- SECURITY DEFINER throughout (not invoker), each gated by an explicit authorize(p_brand_id)
-- check at the top — that check IS the isolation boundary here, same pattern as §5.9's RPCs.
-- security_invoker was tried first and rejected after a real, live-project statement timeout: even
-- with an explicit `where brand_id = p_brand_id` filter, running as invoker leaves RLS's own
-- authorize() qual ALSO applied to every underlying row (RLS is enforced in addition to a
-- function's own WHERE clause, not replaced by it), and authorize() is itself SECURITY DEFINER and
-- therefore never inlinable — so a security-invoker version of dashboard_campaign_performance
-- forced one authorize() call per Kilele engagement_events row (~312k) and blew the project's
-- statement_timeout (57014). DEFINER + an explicit early-exit check trades that per-row cost for
-- one O(1) check per call.

-- Kept security_invoker = true (unlike the functions below): this view is for ad hoc/manual
-- querying under the caller's own RLS, not on the hot dashboard path — dashboard_totals below
-- queries public.contacts directly instead of through this view, precisely to avoid the same
-- per-row RLS cost this comment block describes.
create view public.v_contact_contactable with (security_invoker = true) as
  select
    c.*,
    (
      c.deleted_at is null
      and c.consent_marketing is true
      and c.status in ('active', 'pending')
      and c.email is not null
      and c.email_valid
      and (c.suppressed_until is null or c.suppressed_until <= now())
    ) as is_contactable
  from public.contacts c;

-- Totals card: total customers (excludes deleted) and contactable (§6's exact definition —
-- blank/unknown consent is NOT contactable).
create or replace function public.dashboard_totals(p_brand_id uuid)
returns table (total_customers bigint, contactable bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.authorize(p_brand_id) then
    raise insufficient_privilege using message = 'not a member of this brand';
  end if;

  return query
    select
      count(*) filter (where deleted_at is null)::bigint,
      count(*) filter (where
        deleted_at is null
        and consent_marketing is true
        and status in ('active', 'pending')
        and email is not null
        and email_valid
        and (suppressed_until is null or suppressed_until <= now())
      )::bigint
    from public.contacts
    where brand_id = p_brand_id;
end;
$$;
revoke all on function public.dashboard_totals(uuid) from public;
grant execute on function public.dashboard_totals(uuid) to authenticated;

-- Signups per day, last 30 days, bucketed in the BRAND's own timezone (§2.9), zero-filled via
-- generate_series so an empty day (or an entirely empty brand — Karoo/Marrakech) renders an
-- explicit zero rather than absence the UI would have to distinguish from "still loading".
create or replace function public.dashboard_signups_daily(p_brand_id uuid)
returns table (day date, signups bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if not public.authorize(p_brand_id) then
    raise insufficient_privilege using message = 'not a member of this brand';
  end if;

  select timezone into v_tz from public.brands where id = p_brand_id;

  return query
    with days as (
      select generate_series(
        (now() at time zone v_tz)::date - interval '29 days',
        (now() at time zone v_tz)::date,
        interval '1 day'
      )::date as day
    ),
    counts as (
      select (signup_at at time zone v_tz)::date as day, count(*) as n
      from public.contacts
      where brand_id = p_brand_id
        and signup_at is not null
        and signup_at >= now() - interval '30 days'
        and signup_at <= now()
      group by 1
    )
    select d.day, coalesce(c.n, 0)::bigint
    from days d
    left join counts c using (day)
    order by d.day;
end;
$$;
revoke all on function public.dashboard_signups_daily(uuid) from public;
grant execute on function public.dashboard_signups_daily(uuid) to authenticated;

-- Per-campaign reported figures (as supplied, never reconciled) alongside engagement-log-computed
-- figures, plus the two data-quality flags found in §2.8 — both shown, never silently "fixed".
create or replace function public.dashboard_campaign_performance(p_brand_id uuid)
returns table (
  campaign_id uuid,
  external_id text,
  name text,
  channel text,
  sent_at timestamptz,
  reported_sent int,
  reported_delivered int,
  reported_bounced int,
  reported_opens int,
  reported_clicks int,
  spend numeric,
  unique_opens bigint,
  total_opens bigint,
  unique_unsubscribes bigint,
  open_rate numeric,
  bounce_rate numeric,
  opens_exceed_delivered boolean,
  reported_totals_inconsistent boolean
)
language plpgsql stable security definer
set search_path = ''
-- Normally ~500ms-3.4s at Kilele's scale even before the 0015 covering index (see that
-- migration's header). Measured hitting the authenticated role's 8s statement_timeout (57014)
-- under this session's own sustained cumulative real-project test load (see 0009_rpc.sql's
-- preview_send comment for the same phenomenon) — this override is headroom for that, not a sign
-- this query is normally slow.
set statement_timeout = '20s'
as $$
begin
  if not public.authorize(p_brand_id) then
    raise insufficient_privilege using message = 'not a member of this brand';
  end if;

  return query
    select
      c.id,
      c.external_id,
      c.name,
      c.channel,
      c.sent_at,
      c.reported_sent,
      c.reported_delivered,
      c.reported_bounced,
      c.reported_opens,
      c.reported_clicks,
      c.spend,
      coalesce(e.unique_opens, 0),
      coalesce(e.total_opens, 0),
      coalesce(e.unique_unsubscribes, 0),
      case when coalesce(c.reported_delivered, 0) > 0
        then round(coalesce(e.unique_opens, 0)::numeric / c.reported_delivered, 4)
        else null end,
      case when coalesce(c.reported_sent, 0) > 0
        then round(coalesce(c.reported_bounced, 0)::numeric / c.reported_sent, 4)
        else null end,
      (c.reported_opens is not null and c.reported_delivered is not null and c.reported_opens > c.reported_delivered),
      (c.reported_sent is not null and c.reported_delivered is not null and c.reported_bounced is not null
        and c.reported_delivered + c.reported_bounced <> c.reported_sent)
    from public.campaigns c
    left join (
      -- engagement_events.campaign_id must stay qualified: this function's RETURNS TABLE also
      -- declares an OUT parameter named campaign_id, and a bare reference here is ambiguous
      -- between the two (42702) — the same class of bug fixed in apply_import_chunk (Phase 5).
      select
        engagement_events.campaign_id,
        count(distinct contact_id) filter (where event_type = 'opened') as unique_opens,
        count(*) filter (where event_type = 'opened') as total_opens,
        count(distinct contact_id) filter (where event_type = 'unsubscribed') as unique_unsubscribes
      from public.engagement_events
      where brand_id = p_brand_id
      group by engagement_events.campaign_id
    ) e on e.campaign_id = c.id
    where c.brand_id = p_brand_id
    order by c.sent_at desc nulls last, c.external_id;
end;
$$;
revoke all on function public.dashboard_campaign_performance(uuid) from public;
grant execute on function public.dashboard_campaign_performance(uuid) to authenticated;

-- Keyset-paginated contact list — never an OFFSET scan, so page 800 at 84k rows costs the same as
-- page 1 (AC-SCALE-02). Cursor is (created_at, id) descending, matching contacts_keyset_idx.
create or replace function public.contacts_page(
  p_brand_id uuid,
  p_limit int default 50,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns setof public.contacts
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.authorize(p_brand_id) then
    raise insufficient_privilege using message = 'not a member of this brand';
  end if;

  return query
    select c.*
    from public.contacts c
    where c.brand_id = p_brand_id
      and (
        p_after_created_at is null
        or (c.created_at, c.id) < (p_after_created_at, p_after_id)
      )
    order by c.created_at desc, c.id desc
    limit least(greatest(p_limit, 1), 200);
end;
$$;
revoke all on function public.contacts_page(uuid, int, timestamptz, uuid) from public;
grant execute on function public.contacts_page(uuid, int, timestamptz, uuid) to authenticated;

-- ============================================================================
-- 0011_auth_hook.sql
-- ============================================================================
-- Phase 4 (docs/IMPLEMENTATION_PLAN.md §8 Phase 4): the allowlist gate and the trigger that turns
-- an allowlisted signup into a membership. Numbered 0011 to match the plan's final schema
-- section (§5), which groups this with the rest of auth — Postgres/Supabase migrations apply in
-- filename order regardless of numeric gaps, so this is safe to apply directly after 0004.

-- ============================================================================================
-- before_user_created auth hook. Registered in supabase/config.toml under
-- [auth.hook.before_user_created] and pushed to the live project with `supabase config push`
-- (this is project Auth configuration, not a SQL migration — `db push` does not apply it).
--
-- Fires for EVERY path that creates a new auth.users row — email/password admin-provisioning,
-- and a first-time Google OAuth sign-in alike — because it hooks user creation at the GoTrue
-- level, not a specific HTTP endpoint. This is what actually keeps outsiders out; disabling
-- public email signup (supabase/config.toml, [auth.email] enable_signup = false) is belt and
-- braces on top of it, not a substitute for it.
--
-- Rejects by raising an exception rather than returning an "error" JSON shape: every Supabase
-- Postgres auth hook treats an unhandled exception as hook failure, which is the safe, fail-closed
-- behaviour to depend on if this hook's exact expected payload shape ever turns out to differ
-- from what's assumed below — an exception during payload parsing still rejects the signup rather
-- than silently letting it through.
-- ============================================================================================
create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- citext installed into the `public` schema on this project (confirmed via pg_extension) —
  -- schema-qualified because `search_path = ''` above means even `public` isn't searched
  -- implicitly. Worth remembering for every later SECURITY DEFINER function that touches a
  -- citext column: this project's pgcrypto lives in `extensions`, not `public`, so that one
  -- needs `extensions.gen_random_uuid()` etc. instead — the two extensions are NOT in the same
  -- schema on this project, verified by querying pg_extension directly rather than assumed.
  incoming_email public.citext;
begin
  -- The documented shape nests the new user under "user"; fall back to a top-level "email" in
  -- case that differs, but never fall back to *allowing* an unparseable payload through.
  incoming_email := coalesce(event #>> '{user,email}', event ->> 'email');

  if incoming_email is null then
    raise exception 'before_user_created_hook: could not determine an email from the event payload';
  end if;

  if not exists (
    select 1 from public.allowed_emails ae where ae.email = incoming_email
  ) then
    raise exception 'Sign-up rejected: % is not on the Velocity Growth allowlist.', incoming_email;
  end if;

  return event;
end;
$$;

revoke all on function public.before_user_created_hook(jsonb) from public;
-- GoTrue calls this as the `supabase_auth_admin` role in a hosted project.
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

comment on function public.before_user_created_hook is
  'Auth hook (before_user_created) — rejects any signup whose email is not in allowed_emails. '
  'Registered in supabase/config.toml, applied with `supabase config push`.';

-- ============================================================================================
-- Membership provisioning. An allowlisted signup already passed the hook above by the time this
-- fires, so `allowed_emails` is expected to have a match — but stays defensive (a no-op, not a
-- crash, if it somehow doesn't) rather than assuming that invariant can never be violated.
-- ============================================================================================
create or replace function public.handle_new_user_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed public.allowed_emails%rowtype;
begin
  select * into allowed from public.allowed_emails where email = new.email::public.citext;

  if found then
    insert into public.memberships (user_id, brand_id, role)
    values (new.id, allowed.brand_id, allowed.role)
    on conflict (user_id, brand_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_membership on auth.users;
create trigger on_auth_user_created_membership
  after insert on auth.users
  for each row execute function public.handle_new_user_membership();

comment on function public.handle_new_user_membership is
  'Creates the memberships row for a newly created auth.users row, from allowed_emails. '
  'A no-op (not an error) if the email is not allowlisted — the before_user_created hook is '
  'what actually prevents that row from existing in the first place.';

-- ============================================================================
-- 0012_apply_import_chunk.sql
-- ============================================================================
-- Phase 5: the transactional core of the import worker. One call = one chunk = one transaction:
-- upsert the valid rows, record every issue, advance import_runs' counters and chunk_cursor. If
-- the Edge Function crashes mid-chunk, this function either fully committed or didn't run at
-- all — there is no partial-chunk state to resume from, only "which chunk_cursor did we last
-- commit," which the worker reads back before deciding what to send next.
--
-- service_role only (the worker calls this with the service-role key) — not exposed to
-- authenticated, since it bypasses the owner-only insert policy on contacts/campaigns by design
-- (SECURITY DEFINER) and trusts its caller completely.

-- A prior version of this function (same migration, before the OUT-parameter rename below was
-- discovered by testing directly against the live project) used a return-column shape Postgres
-- won't let `create or replace` migrate away from in place.
drop function if exists public.apply_import_chunk(uuid, int, jsonb, jsonb, boolean);

create or replace function public.apply_import_chunk(
  p_import_run_id uuid,
  p_chunk_no int,
  p_rows jsonb,          -- array of NormalisedContact | NormalisedCampaign (packages/domain/src/import/types.ts)
  p_issues jsonb,         -- array of RowIssue
  p_is_last_chunk boolean
)
-- Named distinctly from import_runs' own inserted_count/updated_count/... columns: PL/pgSQL
-- resolves a bare column name against BOTH an OUT parameter and a table column in the same
-- statement as ambiguous (error 42702) — verified by hitting this for real against the live
-- project before renaming these.
returns table (out_inserted int, out_updated int, out_rejected int, out_warnings int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_kind public.import_kind;
  v_inserted int := 0;
  v_updated int := 0;
  v_rejected int := coalesce((select count(*)::int from jsonb_array_elements(p_issues) e where e->>'severity' = 'error'), 0);
  v_warnings int := coalesce((select count(*)::int from jsonb_array_elements(p_issues) e where e->>'severity' = 'warning'), 0);
  v_row_count int := coalesce(jsonb_array_length(p_rows), 0);
begin
  select brand_id, kind into v_brand_id, v_kind from public.import_runs where id = p_import_run_id;
  if v_brand_id is null then
    raise exception 'apply_import_chunk: import_run % not found', p_import_run_id;
  end if;

  if v_kind = 'contacts' then
    with upserted as (
      insert into public.contacts (
        brand_id, external_id, full_name, email, email_valid, phone_raw, phone_e164,
        country, city, signup_at, status, consent_marketing, deleted_at, suppressed_until,
        notes, source_import_run_id
      )
      select
        v_brand_id,
        r->>'externalId',
        r->>'fullName',
        nullif(r->>'email', '')::public.citext,
        coalesce((r->>'emailValid')::boolean, false),
        r->>'phoneRaw',
        r->>'phoneE164',
        r->>'country',
        r->>'city',
        (r->>'signupAt')::timestamptz,
        coalesce((r->>'status')::public.contact_status, 'active'),
        (r->>'consentMarketing')::boolean,
        (r->>'deletedAt')::timestamptz,
        (r->>'suppressedUntil')::timestamptz,
        r->>'notes',
        p_import_run_id
      from jsonb_array_elements(p_rows) as r
      on conflict (brand_id, external_id) do update set
        full_name = excluded.full_name,
        email = excluded.email,
        email_valid = excluded.email_valid,
        phone_raw = excluded.phone_raw,
        phone_e164 = excluded.phone_e164,
        country = excluded.country,
        city = excluded.city,
        signup_at = excluded.signup_at,
        status = excluded.status,
        consent_marketing = excluded.consent_marketing,
        deleted_at = excluded.deleted_at,
        suppressed_until = excluded.suppressed_until,
        notes = excluded.notes,
        source_import_run_id = excluded.source_import_run_id,
        updated_at = now()
      returning (xmax = 0) as was_insert
    )
    select
      count(*) filter (where was_insert)::int,
      count(*) filter (where not was_insert)::int
    into v_inserted, v_updated
    from upserted;

  elsif v_kind = 'campaigns' then
    with upserted as (
      insert into public.campaigns (
        brand_id, external_id, name, channel, target_country,
        reported_sent, reported_delivered, reported_bounced, reported_opens, reported_clicks,
        spend, sent_at, parent_external_id
      )
      select
        v_brand_id,
        r->>'externalId',
        r->>'name',
        r->>'channel',
        r->>'targetCountry',
        (r->>'reportedSent')::int,
        (r->>'reportedDelivered')::int,
        (r->>'reportedBounced')::int,
        (r->>'reportedOpens')::int,
        (r->>'reportedClicks')::int,
        (r->>'spend')::numeric,
        (r->>'sentAt')::timestamptz,
        r->>'parentExternalId'
      from jsonb_array_elements(p_rows) as r
      on conflict (brand_id, external_id) do update set
        name = excluded.name,
        channel = excluded.channel,
        target_country = excluded.target_country,
        reported_sent = excluded.reported_sent,
        reported_delivered = excluded.reported_delivered,
        reported_bounced = excluded.reported_bounced,
        reported_opens = excluded.reported_opens,
        reported_clicks = excluded.reported_clicks,
        spend = excluded.spend,
        sent_at = excluded.sent_at,
        parent_external_id = excluded.parent_external_id
      returning (xmax = 0) as was_insert
    )
    select
      count(*) filter (where was_insert)::int,
      count(*) filter (where not was_insert)::int
    into v_inserted, v_updated
    from upserted;
  else
    raise exception 'apply_import_chunk: unsupported kind %', v_kind;
  end if;

  insert into public.import_errors (import_run_id, brand_id, row_number, field, value_excerpt, reason_code, reason, severity)
  select
    p_import_run_id,
    v_brand_id,
    (e->>'rowNumber')::int,
    e->>'field',
    e->>'valueExcerpt',
    e->>'reasonCode',
    e->>'reason',
    (e->>'severity')::public.severity
  from jsonb_array_elements(p_issues) as e;

  -- Same transaction as the upserts and the error inserts above: chunk_cursor only ever advances
  -- alongside data that's already durably committed, which is what makes a crash mid-chunk safe
  -- to just retry (docs/IMPLEMENTATION_PLAN.md §1 done-rule 6 applied to import, not just send).
  update public.import_runs set
    processed_rows = processed_rows + v_row_count + v_rejected,
    inserted_count = inserted_count + v_inserted,
    updated_count = updated_count + v_updated,
    rejected_count = rejected_count + v_rejected,
    warning_count = warning_count + v_warnings,
    chunk_cursor = p_chunk_no + 1,
    status = case when p_is_last_chunk then 'succeeded'::public.import_status else 'running'::public.import_status end,
    started_at = coalesce(started_at, now()),
    finished_at = case when p_is_last_chunk then now() else finished_at end
  where id = p_import_run_id;

  return query select v_inserted, v_updated, v_rejected, v_warnings;
end;
$$;

revoke all on function public.apply_import_chunk(uuid, int, jsonb, jsonb, boolean) from public;
grant execute on function public.apply_import_chunk(uuid, int, jsonb, jsonb, boolean) to service_role;

comment on function public.apply_import_chunk is
  'Worker-only. One call = one chunk = one transaction: upsert + errors + counters + cursor '
  'advance together, so a crashed worker resumes from the last COMMITTED chunk_cursor, never a '
  'partial one. See supabase/functions/import-worker/index.ts.';

-- ============================================================================
-- 0013_storage.sql
-- ============================================================================
-- Phase 5: the private `imports` Storage bucket. Path convention:
-- {brand_id}/{import_run_id}/{filename} — storage.foldername(name)[1] is the brand_id segment,
-- which is what every policy below checks against public.authorize(), the same isolation
-- guarantee as every other tenant table (docs/IMPLEMENTATION_PLAN.md §5.3).

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

create policy imports_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imports'
    and public.authorize(((storage.foldername(name))[1])::uuid, 'owner')
  );

create policy imports_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imports'
    and public.authorize(((storage.foldername(name))[1])::uuid, 'analyst')
  );

-- No update/delete policy: an uploaded file is immutable once written. Re-importing means
-- uploading a new object under a new import_run_id, not overwriting an old one.

-- ============================================================================
-- 0014_import_cron.sql
-- ============================================================================
-- Phase 5: schedules import-worker via pg_cron + pg_net, so an import keeps progressing even if
-- the browser tab that started it closes immediately after upload — the actual point of running
-- this as a worker rather than a long-lived request. Every seed file imported so far finished
-- within a single invocation (see docs/DATA_FINDINGS.md-scale evidence in the Phase 5 commit),
-- so this cron tick is a safety net for a file large enough to need more than one, not the
-- primary mechanism — import-start's own fire-and-forget kick is what makes a normal import feel
-- instant.
--
-- The project URL is not sensitive (it's public — it's the same URL this build's submission
-- hands over) and is hardcoded below. The service-role KEY is sensitive and is NOT in this file
-- (never commit that — the repo is public). It's stored once via Supabase Vault, by name, applied
-- manually (the value is never pasted into a doc or migration either):
--   select vault.create_secret('<service-role-key>', 'service_role_key', 'used by pg_cron to call import-worker/sync-events');
-- See docs/MANUAL_SETUP.md.

select cron.schedule(
  'import-worker-tick',
  '10 seconds',
  $$
  select net.http_post(
    url := 'https://dkzfernckoybcnwoxrbu.supabase.co/functions/v1/import-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 0015_campaign_performance_index.sql
-- ============================================================================
-- Phase 6: dashboard_campaign_performance's per-campaign unique-opens/unsubscribes aggregation
-- needs count(distinct contact_id) grouped by campaign_id, filtered by brand_id — without a
-- supporting index, Postgres has to Sort all of a brand's engagement_events rows (external merge,
-- disk spill at Kilele's ~303k rows) before it can dedupe, which measured at ~3.4s on this project
-- and combined with the rest of the function's work exceeded the `authenticated` role's 8s
-- statement_timeout (57014, found via a real read-only integration test against the live project).
--
-- This composite index lets the planner do an Index Only Scan already ordered by
-- (brand_id, campaign_id, contact_id), turning that Sort into a much cheaper Incremental Sort with
-- no disk spill — measured at ~500ms warm-cache after adding it, a ~6.8x improvement.
create index if not exists events_brand_campaign_type_contact_idx
  on public.engagement_events (brand_id, campaign_id, event_type, contact_id);

-- ============================================================================
-- 0016_send_cron.sql
-- ============================================================================
-- Phase 7: schedules send-worker via pg_cron + pg_net, same pattern as 0014_import_cron.sql. There
-- is no client-side "instant kick" for sends (unlike import-start) — confirm_send is a plain RPC,
-- not an Edge Function, so it has no privileged context to fire a service-role request from. A
-- 10s tick keeps the delay between confirming and the first chunk actually going out imperceptible
-- without needing a second Edge Function just to wrap confirm_send.
--
-- Same secrets discipline as 0014_import_cron.sql: the project URL is public and hardcoded; the
-- service-role key is never in this file, only in Vault (docs/MANUAL_SETUP.md).

select cron.schedule(
  'send-worker-tick',
  '10 seconds',
  $$
  select net.http_post(
    url := 'https://dkzfernckoybcnwoxrbu.supabase.co/functions/v1/send-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 0017_event_sync_cron.sql
-- ============================================================================
-- Phase 8: schedules sync-events via pg_cron + pg_net, every minute per §4.2/§8 (event sync is a
-- background poll against a third party, not latency-sensitive the way import/send progress is —
-- 60s matches the plan exactly, unlike the 10s ticks used for the two worker functions). Same
-- secrets discipline as 0014/0016: project URL is public and hardcoded, service-role key lives
-- only in Vault.

select cron.schedule(
  'sync-events-tick',
  '* * * * *', -- every minute — pg_cron's sub-minute '<n> seconds' syntax tops out under 60
  $$
  select net.http_post(
    url := 'https://dkzfernckoybcnwoxrbu.supabase.co/functions/v1/sync-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

