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
