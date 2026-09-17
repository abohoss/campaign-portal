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
