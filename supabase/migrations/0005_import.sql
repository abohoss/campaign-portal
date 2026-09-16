-- Phase 5 (docs/IMPLEMENTATION_PLAN.md §5.5): import tracking. import_runs is the resumability
-- anchor (chunk_cursor/byte_offset survive a crashed worker); import_errors is what the marketer
-- sees for "the data loads, and the marketer can see what didn't" (done-rule 3).

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind public.import_kind not null,
  filename text not null,
  storage_path text not null,
  file_sha256 text,                    -- identical re-upload is detectable and reported
  status public.import_status not null default 'queued',
  total_rows int, processed_rows int not null default 0,
  inserted_count int not null default 0, updated_count int not null default 0,
  rejected_count int not null default 0, warning_count int not null default 0,
  chunk_cursor int not null default 0,  -- resume point; survives a worker crash
  byte_offset bigint not null default 0,
  detected_encoding text, detected_delimiter text,
  error_summary text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz
);
create index import_runs_brand_idx on public.import_runs (brand_id, created_at desc);

alter table public.import_runs enable row level security;
alter table public.import_runs force row level security;

create policy import_runs_select on public.import_runs
  for select to authenticated
  using (public.authorize(brand_id));
create policy import_runs_insert on public.import_runs
  for insert to authenticated
  with check (public.authorize(brand_id, 'owner'));
-- No update/delete policy for authenticated: only the service-role worker (which bypasses RLS)
-- advances status/chunk_cursor/counts. An owner can start an import; only the worker progresses it.

create table public.import_errors (
  id bigserial primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  row_number int not null,             -- 1-based, matches the file the marketer uploaded
  field text,                          -- null = whole-row rejection
  value_excerpt text check (length(value_excerpt) <= 200),
  reason_code text not null,           -- the §2.10 vocabulary (packages/domain/src/import/types.ts ReasonCode)
  reason text not null,                -- human sentence shown in the UI
  severity public.severity not null default 'error',
  created_at timestamptz not null default now()
);
create index import_errors_run_idx on public.import_errors (import_run_id, row_number);

alter table public.import_errors enable row level security;
alter table public.import_errors force row level security;

create policy import_errors_select on public.import_errors
  for select to authenticated
  using (public.authorize(brand_id));
-- No insert/update/delete policy for authenticated: only the service-role worker writes these.

-- Now that import_runs exists, wire contacts.source_import_run_id to it. This FK was declared
-- as a plain uuid column (no reference) in 0004_data_tables.sql, before import_runs existed —
-- see that migration's header comment.
alter table public.contacts
  add constraint contacts_source_import_run_fk
  foreign key (source_import_run_id) references public.import_runs(id) on delete set null;
