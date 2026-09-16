import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCampaignRow, validateCampaignsFile } from "./validate-campaigns.js";
import type { BrandSlug } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "..", "..", "..", "seed");

describe("validateCampaignRow — real rows as fixtures", () => {
  it("accepts a well-formed campaign row", () => {
    const { row, issues } = validateCampaignRow(
      {
        external_id: "KIL-0001",
        campaign_name: "Campaign KIL-0001",
        channel: "email",
        reported_sent: "10640",
        reported_delivered: "10108",
        spend: "650.07",
        sent_at_utc: "2026-02-09T00:08:45Z",
      },
      "kilele",
      1,
    );
    expect(issues).toEqual([]);
    expect(row).toMatchObject({ externalId: "KIL-0001", channel: "email", reportedSent: 10640, spend: 650.07 });
  });

  it("AC-ISO-04: rejects the real Karoo CMP-014 row (parent_campaign_id='KIL-0007', wrong-brand parent)", () => {
    const { row, issues } = validateCampaignRow(
      {
        external_id: "CMP-014",
        campaign_name: "Weekend Flash Sale",
        channel: "email",
        spend: "210.00",
        sent_at_utc: "2026-02-15T01:41:49Z",
        parent_campaign_id: "KIL-0007",
      },
      "karoo",
      2,
    );
    expect(row).toBeNull();
    expect(issues).toEqual([
      expect.objectContaining({ reasonCode: "BRAND_MISMATCH", field: "parent_campaign_id" }),
    ]);
  });

  it("the same CMP-014 imports cleanly under Kilele (empty parent_campaign_id there)", () => {
    const { row, issues } = validateCampaignRow(
      {
        external_id: "CMP-014",
        campaign_name: "Weekend Flash Sale",
        channel: "email",
        spend: "640.00",
        sent_at_utc: "2026-04-09T14:13:33Z",
        parent_campaign_id: "",
      },
      "kilele",
      5,
    );
    expect(issues).toEqual([]);
    expect(row?.externalId).toBe("CMP-014");
  });

  it("parses Marrakech's real decimal-comma spend (221,09)", () => {
    const { row } = validateCampaignRow(
      { external_id: "MAR-0001", campaign_name: "Campagne 1", channel: "sms", spend: "221,09" },
      "marrakech",
      1,
    );
    expect(row?.spend).toBeCloseTo(221.09);
  });

  it("rejects an invalid channel", () => {
    const { row, issues } = validateCampaignRow(
      { external_id: "KIL-0001", channel: "carrier-pigeon" },
      "kilele",
      1,
    );
    expect(row).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "INVALID_CHANNEL" })]);
  });

  it("rejects a missing/malformed external_id", () => {
    const { row, issues } = validateCampaignRow({ channel: "email" }, "kilele", 1);
    expect(row).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "BAD_EXTERNAL_ID" })]);
  });
});

describe("validateCampaignsFile — file-level plumbing (blank lines, ragged rows)", () => {
  it("skips a blank line silently and counts it, doesn't itemise it as an error", () => {
    const buf = new TextEncoder().encode("external_id,channel\nKIL-0001,email\n,\nKIL-0002,sms");
    const result = validateCampaignsFile(buf, "kilele" as BrandSlug);
    expect(result.blankLineCount).toBe(1);
    expect(result.valid).toHaveLength(2);
    expect(result.issues).toEqual([]);
  });

  it("rejects a row with the wrong field count as COLUMN_COUNT_MISMATCH", () => {
    const buf = new TextEncoder().encode("external_id,channel,spend\nKIL-0001,email"); // 2 fields, header has 3
    const result = validateCampaignsFile(buf, "kilele" as BrandSlug);
    expect(result.valid).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ reasonCode: "COLUMN_COUNT_MISMATCH" })]);
  });
});

describe("validateCampaignsFile — end to end against real files", () => {
  it("karoo-campaigns.csv: CMP-014 is the one row rejected, exactly matching the documented finding", () => {
    const buf = readFileSync(join(SEED_DIR, "karoo-campaigns.csv"));
    const result = validateCampaignsFile(buf, "karoo" as BrandSlug);
    expect(result.totalRows).toBe(19);
    expect(result.valid.length).toBe(18);
    expect(result.valid.some((r) => r.externalId === "CMP-014")).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ reasonCode: "BRAND_MISMATCH" })]);
  });

  it("kilele-campaigns.csv: two byte-identical duplicates (CMP-014, KIL-0044) dedupe cleanly", () => {
    const buf = readFileSync(join(SEED_DIR, "kilele-campaigns.csv"));
    const result = validateCampaignsFile(buf, "kilele" as BrandSlug);
    expect(result.totalRows).toBe(46);
    expect(result.valid.length).toBe(44);
    const ids = result.valid.map((r) => r.externalId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate external_ids survive
  });

  it("marrakech-campaigns.csv: all 6 rows import with correctly parsed decimal-comma spend", () => {
    const buf = readFileSync(join(SEED_DIR, "marrakech-campaigns.csv"));
    const result = validateCampaignsFile(buf, "marrakech" as BrandSlug);
    expect(result.valid).toHaveLength(6);
    expect(result.valid.map((r) => r.spend)).toEqual([221.09, 173.47, 273.09, 389.48, 322.95, 61.81]);
  });
});
