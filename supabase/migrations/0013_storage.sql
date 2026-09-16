-- Phase 5: the private `imports` Storage bucket. Path convention:
-- {brand_id}/{import_run_id}/{filename} — storage.foldername(name)[1] is the brand_id segment,
-- which is what every policy below checks against public.authorize(), the same isolation
-- guarantee as every other tenant table (docs/IMPLEMENTATION_PLAN.md §5.3).

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

create policy imports_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imports'
    and public.authorize(((storage.foldername(name))[1])::uuid, 'owner')
  );

create policy imports_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imports'
    and public.authorize(((storage.foldername(name))[1])::uuid, 'analyst')
  );

-- No update/delete policy: an uploaded file is immutable once written. Re-importing means
-- uploading a new object under a new import_run_id, not overwriting an old one.
