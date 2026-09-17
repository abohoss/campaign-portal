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
