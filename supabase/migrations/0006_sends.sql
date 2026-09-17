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
