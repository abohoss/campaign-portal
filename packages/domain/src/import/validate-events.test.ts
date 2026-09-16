import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEventsFile } from "./validate-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "..", "..", "..", "seed");

describe("validateEventsFile — real seed vocabulary mapping", () => {
  it("maps every real seed event_type to the canonical DB vocabulary (§2.7)", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\n" +
        "EV-1,CT-1,KIL-0001,open,email,2026-03-01T00:00:00Z\n" +
        "EV-2,CT-1,KIL-0001,click,email,2026-03-01T00:00:01Z\n" +
        "EV-3,CT-1,KIL-0001,bounce,email,2026-03-01T00:00:02Z\n" +
        "EV-4,CT-1,KIL-0001,unsubscribe,email,2026-03-01T00:00:03Z\n" +
        "EV-5,CT-1,KIL-0001,complaint,email,2026-03-01T00:00:04Z\n",
    );
    const result = validateEventsFile(buf, new Set(["CT-1"]), new Set(["KIL-0001"]));
    expect(result.valid.map((e) => e.eventType)).toEqual([
      "opened", "clicked", "bounced", "unsubscribed", "complained",
    ]);
  });

  it("AC-EVT-07: quarantines an event with an unknown contact, doesn't drop it silently", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\n" +
        "EV-1,CT-UNKNOWN,KIL-0001,open,email,2026-03-01T00:00:00Z\n",
    );
    const result = validateEventsFile(buf, new Set(), new Set(["KIL-0001"]));
    expect(result.valid).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ reasonCode: "UNKNOWN_CONTACT", severity: "warning" })]);
  });

  it("AC-IMP-11: quarantines the real Marrakech orphan-campaign shape (MAR-0007 doesn't exist)", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\n" +
        "EV-00000549,CT-000324,MAR-0007,open,email,2026-03-08T17:29:18.080024Z\n",
    );
    const result = validateEventsFile(buf, new Set(["CT-000324"]), new Set(["MAR-0001"])); // MAR-0007 absent
    expect(result.valid).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ reasonCode: "UNKNOWN_CAMPAIGN" })]);
  });

  it("quarantines an unrecognised event_type rather than dropping or guessing", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\n" +
        "EV-1,CT-1,KIL-0001,carrier-pigeon-delivered,email,2026-03-01T00:00:00Z\n",
    );
    const result = validateEventsFile(buf, new Set(["CT-1"]), new Set(["KIL-0001"]));
    expect(result.valid).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ reasonCode: "UNKNOWN_EVENT_TYPE" })]);
  });
});

describe("validateEventsFile — file-level plumbing (blank lines, ragged rows, missing fields)", () => {
  it("skips a blank line silently and counts it", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\n" +
        "EV-1,CT-1,KIL-0001,open,email,2026-03-01T00:00:00Z\n" +
        ",,,,,\n" +
        "EV-2,CT-1,KIL-0001,click,email,2026-03-01T00:00:01Z",
    );
    const result = validateEventsFile(buf, new Set(["CT-1"]), new Set(["KIL-0001"]));
    expect(result.blankLineCount).toBe(1);
    expect(result.valid).toHaveLength(2);
  });

  it("rejects a row with the wrong field count as COLUMN_COUNT_MISMATCH", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\nEV-1,CT-1",
    );
    const result = validateEventsFile(buf, new Set(["CT-1"]), new Set(["KIL-0001"]));
    expect(result.valid).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ reasonCode: "COLUMN_COUNT_MISMATCH" })]);
  });

  it("rejects a row missing a required field (e.g. occurred_at_utc) without throwing", () => {
    const buf = new TextEncoder().encode(
      "event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc\n" +
        "EV-1,CT-1,KIL-0001,open,email,\n",
    );
    const result = validateEventsFile(buf, new Set(["CT-1"]), new Set(["KIL-0001"]));
    expect(result.valid).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ severity: "error" })]);
  });
});

describe("validateEventsFile — end to end against the real Marrakech events file", () => {
  it("matches the documented profile: 633 of 940 events reference unknown campaigns", () => {
    const buf = readFileSync(join(SEED_DIR, "marrakech-events.csv"));
    // Only MAR-0001..MAR-0006 exist in marrakech-campaigns.csv (§2.7).
    const knownCampaigns = new Set(["MAR-0001", "MAR-0002", "MAR-0003", "MAR-0004", "MAR-0005", "MAR-0006"]);
    // Every contact referenced in the events file is assumed known for this test — it's the
    // campaign-orphan behaviour being verified here, matching the documented finding exactly.
    const buf2 = readFileSync(join(SEED_DIR, "marrakech-events.csv"));
    const text = new TextDecoder().decode(buf2);
    const contactIds = new Set(
      text
        .split("\n")
        .slice(1)
        .map((line) => line.split(";")[1])
        .filter((v): v is string => !!v),
    );

    const result = validateEventsFile(buf, contactIds, knownCampaigns);
    const unknownCampaignIssues = result.issues.filter((i) => i.reasonCode === "UNKNOWN_CAMPAIGN");
    expect(unknownCampaignIssues).toHaveLength(633);
    expect(result.valid).toHaveLength(940 - 633);
  });
});
