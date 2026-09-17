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
-- project, close enough to the `authenticated` role's 8s statement_timeout that it genuinely timed
-- out (57014) in a real integration test run. A function-scoped SET (reverted automatically when
-- the call returns, unlike a role-wide change) gives this specific, deliberate, infrequent action
-- headroom without loosening the timeout for every other authenticated query.
set statement_timeout = '25s'
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
