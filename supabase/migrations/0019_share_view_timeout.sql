-- Real failure, found by the integration suite (tests/integration/share.test.ts): a freshly
-- created share link's very first correct-password view returned 57014 ("canceling statement due
-- to statement timeout") from share_view, not a logic bug — a debug script confirmed the token's
-- SHA-256 round-trips byte-for-byte and the RPC call shape is exactly right; the call simply timed
-- out. Same root cause class already fixed once for preview_send (0009_rpc.sql) and again for
-- dashboard_campaign_performance (0010_metrics.sql, 0015's index): the authenticated/anon role's
-- default 8s statement_timeout, combined with this session's own cumulative heavy real-project
-- test load, and here also the deliberately expensive constant-time bcrypt compare. share_view was
-- the one SECURITY DEFINER function in this build that never got the same override.
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
set statement_timeout = '15s'
as $$
declare
  v_link public.share_links;
  v_recent_attempts int;
  v_ok boolean := false;
  v_token_sha256 bytea;
  v_dummy_hash constant text := '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0drjOFB1TW1gvUiRCqR0h6QGpwoZTgS';
begin
  begin
    v_token_sha256 := decode(p_token_sha256_hex, 'hex');
  exception when others then
    return;
  end;

  select count(*) into v_recent_attempts
  from public.share_link_attempts
  where attempted_at > now() - interval '10 minutes'
    and (token_sha256 = v_token_sha256 or ip_hash = p_ip_hash);
  if v_recent_attempts >= 20 then
    return;
  end if;

  select * into v_link from public.share_links where token_sha256 = v_token_sha256;

  if v_link.id is null then
    perform extensions.crypt(p_password, v_dummy_hash);
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
