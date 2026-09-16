import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateContactRow, validateContactsFile } from "./validate-contacts.js";
import type { BrandSlug } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "..", "..", "..", "seed");

// A fixed clock so SIGNUP_IN_FUTURE tests are deterministic regardless of when the suite runs.
const NOW = new Date("2026-09-16T00:00:00Z").getTime();

describe("validateContactRow — one rule at a time, real seed rows as fixtures", () => {
  it("AC-IMP-02: rejects a valid row cleanly (baseline, real CT-007796 shape)", () => {
    const { row, issues } = validateContactRow(
      {
        external_id: "CT-007796",
        full_name: "Fatima Achieng",
        email: "  JAMES.WANJIRU.KIL7488@VG-EVAL.TEST ",
        phone: "254-712-768955",
        country: "KE",
        city: "Kericho",
        signup_at: "2026-01-18T09:34:08Z",
        status: "active",
        consent_marketing: "TRUE",
        brand_code: "KILELE",
      },
      "kilele",
      2,
      NOW,
    );
    expect(issues).toEqual([]);
    expect(row).toMatchObject({
      externalId: "CT-007796",
      email: "james.wanjiru.kil7488@vg-eval.test", // AC-IMP-06: trimmed + lowercased
      emailValid: true,
      country: "KE",
      status: "active",
      consentMarketing: true,
    });
  });

  it("rejects the real embedded-header row (kilele-contacts.csv, data row 39,998)", () => {
    const { row, issues } = validateContactRow(
      { external_id: "external_id", full_name: "full_name", email: "email", city: "city" },
      "kilele",
      39998,
    );
    expect(row).toBeNull();
    expect(issues).toEqual([
      expect.objectContaining({ reasonCode: "EMBEDDED_HEADER_ROW", severity: "error" }),
    ]);
  });

  it("rejects a short/shifted row via missing external_id (real CT-904924 shape, 9 of 13 fields)", () => {
    // The row itself never reaches validateContactRow when short — validateContactsFile catches
    // it as COLUMN_COUNT_MISMATCH before mapping headers. This tests the fallback: even if
    // somehow mapped with a missing external_id, BAD_EXTERNAL_ID still catches it.
    const { row, issues } = validateContactRow({ full_name: "Rachid Fassi" }, "kilele", 277);
    expect(row).toBeNull();
    expect(issues[0]).toMatchObject({ reasonCode: "BAD_EXTERNAL_ID" });
  });

  it("AC-ISO-04/AC-IMP-07: rejects the real KAROO-branded row found inside kilele-contacts.csv", () => {
    const { row, issues } = validateContactRow(
      {
        external_id: "CT-800184",
        full_name: "Omar Benali",
        email: "leak.kar.184@vg-eval.test",
        phone: "0719624399",
        country: "ZA",
        city: "Cape Town",
        signup_at: "2026-02-21T10:24:51Z",
        status: "active",
        consent_marketing: "true",
        brand_code: "KAROO",
      },
      "kilele",
      1,
      NOW,
    );
    expect(row).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "BRAND_MISMATCH" })]);
  });

  it("rejects a real future signup_at (2027-06-27T19:31:00Z)", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", signup_at: "2027-06-27T19:31:00Z" },
      "kilele",
      1,
      NOW,
    );
    expect(row).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "SIGNUP_IN_FUTURE" })]);
  });

  it("rejects an unparseable signup_at without throwing", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", signup_at: "not a date at all" },
      "kilele",
      1,
    );
    expect(row).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "UNPARSEABLE_DATE" })]);
  });

  it("a real malformed email (real value: 'double@@vg-eval.test') is a warning, not a row rejection", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", email: "double@@vg-eval.test" },
      "kilele",
      1,
    );
    expect(row).not.toBeNull();
    expect(row?.email).toBeNull();
    expect(row?.emailValid).toBe(false);
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "INVALID_EMAIL", severity: "warning" })]);
  });

  it("a missing email is a warning, not a row rejection, and the contact is not contactable", () => {
    const { row, issues } = validateContactRow({ external_id: "CT-1" }, "kilele", 1);
    expect(row).not.toBeNull();
    expect(row?.emailValid).toBe(false);
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "MISSING_EMAIL", severity: "warning" })]);
  });

  it("real scientific-notation phone (7.77E+08) is unrecoverable, warns, keeps the row", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", email: "a@vg-eval.test", phone: "7.77E+08" },
      "kilele",
      1,
    );
    expect(row).not.toBeNull();
    expect(row?.phoneE164).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "PHONE_UNRECOVERABLE", severity: "warning" })]);
  });

  it("an unrecognised country warns and clears the field, keeps the row", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", email: "a@vg-eval.test", country: "ZZ" },
      "kilele",
      1,
    );
    expect(row).not.toBeNull();
    expect(row?.country).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "UNKNOWN_COUNTRY", severity: "warning" })]);
  });

  it("an unrecognised status warns and defaults to active, keeps the row", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", email: "a@vg-eval.test", status: "archived" },
      "kilele",
      1,
    );
    expect(row).not.toBeNull();
    expect(row?.status).toBe("active");
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "UNKNOWN_STATUS", severity: "warning" })]);
  });

  it("notes over 1,000 chars warn and truncate through the full row validator (real 4,200-char row)", () => {
    const { row, issues } = validateContactRow(
      { external_id: "CT-1", email: "a@vg-eval.test", notes: "X".repeat(4200) },
      "kilele",
      1,
    );
    expect(row?.notes).toHaveLength(1000);
    expect(issues).toEqual([expect.objectContaining({ reasonCode: "NOTES_TRUNCATED", severity: "warning" })]);
  });

  it("blank consent stays null (unknown), never coerced to false", () => {
    const { row } = validateContactRow({ external_id: "CT-1", consent_marketing: "" }, "kilele", 1);
    expect(row?.consentMarketing).toBeNull();
  });
});

describe("validateContactsFile — end to end against a real seed file", () => {
  it("marrakech-contacts.csv matches the documented profile exactly", () => {
    const buf = readFileSync(join(SEED_DIR, "marrakech-contacts.csv"));
    const result = validateContactsFile(buf, "marrakech" as BrandSlug);

    expect(result.detectedDelimiter).toBe(";");
    expect(result.detectedEncoding).toBe("utf-8");
    expect(result.totalRows).toBe(960); // 957 data rows + 3 mid-file blank lines
    expect(result.blankLineCount).toBe(3);
    expect(result.valid.length).toBe(918); // 960 - 3 blank - 15 short rows - 24 duplicates

    const byCode = new Map<string, number>();
    for (const i of result.issues) byCode.set(i.reasonCode, (byCode.get(i.reasonCode) ?? 0) + 1);
    expect(byCode.get("COLUMN_COUNT_MISMATCH")).toBe(15);
    expect(byCode.get("DUPLICATE_IN_FILE")).toBe(24);
  });

  it("re-parsing the same file twice produces byte-identical valid[] output (a precondition for AC-IMP-09's DB-level idempotency)", () => {
    const buf = readFileSync(join(SEED_DIR, "marrakech-contacts.csv"));
    const a = validateContactsFile(buf, "marrakech" as BrandSlug);
    const b = validateContactsFile(buf, "marrakech" as BrandSlug);
    expect(a.valid).toEqual(b.valid);
  });
});

describe("property: chunking invariant (§7.3 import.chunking.prop)", () => {
  it("for any chunk size 1..5000, slicing valid[] into chunks and concatenating them back equals the original — the invariant apply_import_chunk's chunk_cursor resumability depends on", () => {
    const buf = readFileSync(join(SEED_DIR, "marrakech-contacts.csv"));
    const result = validateContactsFile(buf, "marrakech" as BrandSlug);

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (chunkSize) => {
        const chunks: (typeof result.valid)[] = [];
        for (let i = 0; i < result.valid.length; i += chunkSize) {
          chunks.push(result.valid.slice(i, i + chunkSize));
        }
        const reassembled = chunks.flat();
        expect(reassembled).toEqual(result.valid);
        // Every chunk boundary lands on a real row — no chunk is ever empty except possibly
        // trailing on an exact multiple, and no row is ever split or duplicated across chunks.
        const seen = new Set(reassembled.map((r) => r.externalId));
        expect(seen.size).toBe(result.valid.length);
      }),
      { numRuns: 50 }, // each run re-slices ~918 rows; keep the property test itself fast
    );
  });
});

describe("property: validateContactRow never throws, for any input shape", () => {
  const brands: BrandSlug[] = ["kilele", "karoo", "marrakech"];
  it("never throws regardless of field contents", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(
            "external_id", "full_name", "email", "phone", "country", "city",
            "signup_at", "status", "consent_marketing", "brand_code", "notes",
          ),
          fc.option(fc.string(), { nil: undefined }),
        ),
        fc.constantFrom(...brands),
        (row, brand) => {
          expect(() => validateContactRow(row, brand, 1)).not.toThrow();
        },
      ),
    );
  });

  it("every rejected row has exactly one error-severity issue; every kept row has zero", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom("external_id", "email", "signup_at", "brand_code"),
          fc.option(fc.string(), { nil: undefined }),
        ),
        fc.constantFrom(...brands),
        (row, brand) => {
          const { row: result, issues } = validateContactRow(row, brand, 1);
          const errors = issues.filter((i) => i.severity === "error");
          if (result === null) expect(errors.length).toBe(1);
          else expect(errors.length).toBe(0);
        },
      ),
    );
  });
});
