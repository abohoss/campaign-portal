-- Phase 8: schedules sync-events via pg_cron + pg_net, every minute per §4.2/§8 (event sync is a
-- background poll against a third party, not latency-sensitive the way import/send progress is —
-- 60s matches the plan exactly, unlike the 10s ticks used for the two worker functions). Same
-- secrets discipline as 0014/0016: project URL is public and hardcoded, service-role key lives
-- only in Vault.

select cron.schedule(
  'sync-events-tick',
  '* * * * *', -- every minute — pg_cron's sub-minute '<n> seconds' syntax tops out under 60
  $$
  select net.http_post(
    url := 'https://dkzfernckoybcnwoxrbu.supabase.co/functions/v1/sync-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
