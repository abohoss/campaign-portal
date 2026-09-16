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
