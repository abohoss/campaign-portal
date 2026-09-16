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
