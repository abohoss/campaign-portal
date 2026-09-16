-- Phase 5: schedules import-worker via pg_cron + pg_net, so an import keeps progressing even if
-- the browser tab that started it closes immediately after upload — the actual point of running
-- this as a worker rather than a long-lived request. Every seed file imported so far finished
-- within a single invocation (see docs/DATA_FINDINGS.md-scale evidence in the Phase 5 commit),
-- so this cron tick is a safety net for a file large enough to need more than one, not the
-- primary mechanism — import-start's own fire-and-forget kick is what makes a normal import feel
-- instant.
--
-- The project URL is not sensitive (it's public — it's the same URL this build's submission
-- hands over) and is hardcoded below. The service-role KEY is sensitive and is NOT in this file
-- (never commit that — the repo is public). It's stored once via Supabase Vault, by name, applied
-- manually (the value is never pasted into a doc or migration either):
--   select vault.create_secret('<service-role-key>', 'service_role_key', 'used by pg_cron to call import-worker/sync-events');
-- See docs/MANUAL_SETUP.md.

select cron.schedule(
  'import-worker-tick',
  '10 seconds',
  $$
  select net.http_post(
    url := 'https://dkzfernckoybcnwoxrbu.supabase.co/functions/v1/import-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
