/**
 * scripts/seed-events.ts
 *
 * Loads the historical engagement events (kilele-events.csv, karoo-events.csv,
 * marrakech-events.csv — ~387k rows total) into public.engagement_events for real, against the
 * live project. Not a UI workflow (docs/IMPLEMENTATION_PLAN.md §8 Phase 5's executor prompt: "not
 * a UI workflow") — no marketer ever uploads a raw engagement log, so this is a script, using the
 * same validators (packages/domain/src/import/validate-events.ts) and the same quarantine rules
 * as everything else.
 *
 * Idempotent on (brand_id, provider_event_id) — safe to re-run. Chunks writes at 5,000 rows per
 * insert (same chunk size as the import worker) to keep each request a reasonable size; not
 * resumable via a cursor the way the import worker is, since this is a one-shot operator script
 * run from a terminal, not a stateless Edge Function — if it's interrupted, just re-run it.
 *
 * Usage: npx tsx scripts/seed-events.ts <brandSlug> <path/to/events.csv>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { validateEventsFile } from "../packages/domain/src/import/validate-events.js";

const CHUNK_SIZE = 5000;

function loadEnvLocal(): Record<string, string> {
  const text = readFileSync(".env.local", "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

async function main(): Promise<void> {
  const [brandSlug, filePath] = process.argv.slice(2);
  if (!brandSlug || !filePath) {
    console.error("Usage: seed-events.ts <brandSlug> <path/to/events.csv>");
    process.exit(1);
  }

  const env = loadEnvLocal();
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: brand } = await admin.from("brands").select("id").eq("slug", brandSlug).single();
  if (!brand) throw new Error(`Brand '${brandSlug}' not found`);
  const brandId = brand.id as string; // narrowed once here, not re-derived inside closures below

  // PostgREST truncates at 1,000 rows per request (docs/IMPLEMENTATION_PLAN.md §6) — .range()
  // pages around that, but ONLY correctly if the query has a stable ORDER BY. Without one,
  // Postgres doesn't guarantee the same row ordering across separate paginated queries, so pages
  // can overlap or skip rows entirely. Found for real, twice, from the same root cause: an
  // unordered fetch of just external_id undercounted Kilele's 82,424 contacts as 72,276, wrongly
  // quarantining 38,907 real events as UNKNOWN_CONTACT — and a SEPARATE fetch a few lines below,
  // for the external_id -> uuid map, had no .range() at all, meaning it silently returned only
  // the first ~1,000 contacts and would have left contact_id null on the vast majority of events
  // (engagement_events.contact_id is nullable, so this would have failed silently, not loudly).
  // One paginated fetch now builds both the id-set (for validation) and the id-map (for
  // insertion) together, so there is exactly one place this can go wrong instead of two.
  async function fetchAllIdRows(table: "contacts" | "campaigns"): Promise<{ id: string; external_id: string }[]> {
    const rows: { id: string; external_id: string }[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from(table)
        .select("id, external_id")
        .eq("brand_id", brandId)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as { id: string; external_id: string }[]));
      if (data.length < 1000) break;
      from += 1000;
    }
    return rows;
  }

  console.log("Fetching known contacts/campaigns for", brandSlug, "...");
  const contactRows = await fetchAllIdRows("contacts");
  const campaignRows = await fetchAllIdRows("campaigns");
  const contactIdMap = new Map(contactRows.map((r) => [r.external_id, r.id]));
  const campaignIdMap = new Map(campaignRows.map((r) => [r.external_id, r.id]));
  const contactIds = new Set(contactIdMap.keys());
  const campaignIds = new Set(campaignIdMap.keys());
  console.log(`  ${contactIds.size} known contacts, ${campaignIds.size} known campaigns`);

  const buf = readFileSync(filePath);
  console.log(`Validating ${filePath} (${buf.length.toLocaleString()} bytes)...`);
  const result = validateEventsFile(buf, contactIds, campaignIds);
  console.log(
    `  totalRows=${result.totalRows} valid=${result.valid.length} blankLines=${result.blankLineCount} issues=${result.issues.length}`,
  );
  const byCode = new Map<string, number>();
  for (const i of result.issues) byCode.set(i.reasonCode, (byCode.get(i.reasonCode) ?? 0) + 1);
  console.log("  by reason code:", Object.fromEntries(byCode));

  // §2.3/§2.7: duplicate event_ids in the seed are byte-identical (verified during data
  // profiling — 8,310 in kilele-events.csv, 4,735 in karoo-events.csv, 0 conflicting), so which
  // occurrence survives doesn't matter. Still required regardless of that: Postgres's
  // ON CONFLICT DO UPDATE errors ("cannot affect row a second time") if the SAME conflict key
  // appears twice within one INSERT statement — found for real, re-running this exact script.
  // ignoreDuplicates: true would paper over this by skipping instead of erroring, which is
  // exactly the failure mode this script's own history (see the comment above) shows is
  // dangerous to lean on — dedupe explicitly instead, so it's visible and intentional.
  const dedupedValid = [...new Map(result.valid.map((e) => [e.providerEventId, e])).values()];
  if (dedupedValid.length !== result.valid.length) {
    console.log(`  deduped ${result.valid.length - dedupedValid.length} duplicate event_id(s) within the file`);
  }

  let inserted = 0;
  for (let i = 0; i < dedupedValid.length; i += CHUNK_SIZE) {
    const chunk = dedupedValid.slice(i, i + CHUNK_SIZE).map((e) => ({
      brand_id: brandId,
      contact_id: contactIdMap.get(e.externalContactId),
      campaign_id: campaignIdMap.get(e.campaignExternalId),
      provider_event_id: e.providerEventId,
      event_type: e.eventType,
      channel: e.channel,
      occurred_at: e.occurredAt,
      source: "seed",
    }));
    // ignoreDuplicates deliberately NOT used: a conflict should UPDATE (fixing a row that was
    // previously inserted with bad data, e.g. this script's own earlier pagination bug — see the
    // comment above), never silently skip. Idempotency here comes from the upsert key
    // (brand_id, provider_event_id) making a clean re-run a no-op, not from ignoring conflicts.
    const { error, count } = await admin
      .from("engagement_events")
      .upsert(chunk, { onConflict: "brand_id,provider_event_id", count: "exact" });
    if (error) throw error;
    inserted += count ?? 0;
    console.log(`  chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(dedupedValid.length / CHUNK_SIZE)}: upserted ${chunk.length} rows`);
  }

  const { count: finalCount } = await admin
    .from("engagement_events")
    .select("*", { count: "exact", head: true })
    .eq("brand_id", brandId);
  console.log(`\nDone. Upserted ${inserted} row(s) this run. ${brandSlug} now has ${finalCount} engagement_events row(s) total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
