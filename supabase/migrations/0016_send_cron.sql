-- Phase 7: schedules send-worker via pg_cron + pg_net, same pattern as 0014_import_cron.sql. There
-- is no client-side "instant kick" for sends (unlike import-start) — confirm_send is a plain RPC,
-- not an Edge Function, so it has no privileged context to fire a service-role request from. A
-- 10s tick keeps the delay between confirming and the first chunk actually going out imperceptible
-- without needing a second Edge Function just to wrap confirm_send.
--
-- Same secrets discipline as 0014_import_cron.sql: the project URL is public and hardcoded; the
-- service-role key is never in this file, only in Vault (docs/MANUAL_SETUP.md).

select cron.schedule(
  'send-worker-tick',
  '10 seconds',
  $$
  select net.http_post(
    url := 'https://dkzfernckoybcnwoxrbu.supabase.co/functions/v1/send-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
