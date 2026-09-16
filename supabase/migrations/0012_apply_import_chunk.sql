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
