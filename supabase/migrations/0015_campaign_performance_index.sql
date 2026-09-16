-- Phase 6: dashboard_campaign_performance's per-campaign unique-opens/unsubscribes aggregation
-- needs count(distinct contact_id) grouped by campaign_id, filtered by brand_id — without a
-- supporting index, Postgres has to Sort all of a brand's engagement_events rows (external merge,
-- disk spill at Kilele's ~303k rows) before it can dedupe, which measured at ~3.4s on this project
-- and combined with the rest of the function's work exceeded the `authenticated` role's 8s
-- statement_timeout (57014, found via a real read-only integration test against the live project).
--
-- This composite index lets the planner do an Index Only Scan already ordered by
-- (brand_id, campaign_id, contact_id), turning that Sort into a much cheaper Incremental Sort with
-- no disk spill — measured at ~500ms warm-cache after adding it, a ~6.8x improvement.
create index if not exists events_brand_campaign_type_contact_idx
  on public.engagement_events (brand_id, campaign_id, event_type, contact_id);
