-- Phase 3 (docs/IMPLEMENTATION_PLAN.md §5.2): tenancy tables. RLS for these lands in
-- 0003_rls_policies.sql, alongside the public.authorize() helper they're checked against.

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null,
  country char(2) not null,
  timezone text not null,     -- IANA zone: Africa/Nairobi | Africa/Johannesburg | Africa/Casablanca
  brand_code text not null unique check (brand_code = upper(brand_code)),  -- KILELE | KAROO | MARRAKECH
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  role public.brand_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);
create index memberships_brand_idx on public.memberships (brand_id);

-- Auth allowlist consulted by the before-user-created hook (Phase 4). Deliberately gets NO RLS
-- policies at all in 0003 — unreachable by anon and authenticated, service-role/hook only.
create table public.allowed_emails (
  email citext primary key,
  brand_id uuid not null references public.brands (id),
  role public.brand_role not null,
  created_at timestamptz not null default now()
);
