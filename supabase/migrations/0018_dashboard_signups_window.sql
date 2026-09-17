-- Real user feedback on the deployed app: Karoo's and Marrakech's data ends 2026-04-17, so the
-- fixed "last 30 days" window is always empty for them with no way to see anything earlier — the
-- UI only ever said "no signups in this window" with no indication of when the data actually is,
-- or any way to look further back. Adds a variable lookback window plus an extent function so the
-- UI can offer 30/90-day and "all time" views and can name the brand's actual signup date range in
-- the empty state instead of an unexplained wall of zeros.
drop function if exists public.dashboard_signups_daily(uuid);

create or replace function public.dashboard_signups_daily(p_brand_id uuid, p_days int default 30)
returns table (day date, signups bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_days int;
begin
  if not public.authorize(p_brand_id) then
    raise insufficient_privilege using message = 'not a member of this brand';
  end if;

  -- Clamped, not trusted as-is: this is still a user-suppliable RPC argument, and an unbounded
  -- p_days would let generate_series build an arbitrarily large row set.
  v_days := least(greatest(p_days, 1), 1825);

  select timezone into v_tz from public.brands where id = p_brand_id;

  return query
    with days as (
      select generate_series(
        (now() at time zone v_tz)::date - (v_days - 1) * interval '1 day',
        (now() at time zone v_tz)::date,
        interval '1 day'
      )::date as day
    ),
    counts as (
      select (signup_at at time zone v_tz)::date as day, count(*) as n
      from public.contacts
      where brand_id = p_brand_id
        and signup_at is not null
        and signup_at >= now() - (v_days || ' days')::interval
        and signup_at <= now()
      group by 1
    )
    select d.day, coalesce(c.n, 0)::bigint
    from days d
    left join counts c using (day)
    order by d.day;
end;
$$;
revoke all on function public.dashboard_signups_daily(uuid, int) from public;
grant execute on function public.dashboard_signups_daily(uuid, int) to authenticated;

-- Earliest/latest signup on file (in the brand's own timezone) — lets the UI say "most recent
-- signup was 17 Apr 2026" instead of nothing, and size an "all time" window that actually covers
-- the data rather than guessing a fixed number of days.
create or replace function public.dashboard_signup_extent(p_brand_id uuid)
returns table (earliest_signup date, latest_signup date)
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
    select
      min(signup_at at time zone v_tz)::date,
      max(signup_at at time zone v_tz)::date
    from public.contacts
    where brand_id = p_brand_id and signup_at is not null;
end;
$$;
revoke all on function public.dashboard_signup_extent(uuid) from public;
grant execute on function public.dashboard_signup_extent(uuid) to authenticated;
