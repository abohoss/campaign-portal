-- Phase 3 (docs/IMPLEMENTATION_PLAN.md §5.1): extensions and enums shared across every later
-- migration. Nothing here is brand-scoped — no RLS applies to extensions or types.

create extension if not exists pgcrypto;   -- gen_random_uuid(), crypt()/gen_salt() for share-link passwords
create extension if not exists citext;     -- case-insensitive email columns
create extension if not exists pg_cron;    -- event sync + import worker scheduling (Phase 5/8)
create extension if not exists pg_net;     -- async HTTP from pg_cron jobs (Phase 8)

create type public.brand_role      as enum ('owner', 'analyst');
create type public.contact_status  as enum ('active', 'pending', 'unsubscribed', 'bounced');
create type public.event_type      as enum ('delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'complained');
create type public.event_source    as enum ('seed', 'provider');
create type public.send_status     as enum ('draft', 'approved', 'sending', 'sent', 'failed', 'cancelled');
create type public.chunk_state     as enum ('pending', 'in_flight', 'done', 'failed');
create type public.recipient_state as enum ('pending', 'sent', 'rejected', 'failed');
create type public.import_status   as enum ('queued', 'running', 'succeeded', 'partial', 'failed');
create type public.import_kind     as enum ('contacts', 'campaigns');
create type public.severity        as enum ('error', 'warning');
