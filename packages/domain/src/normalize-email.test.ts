import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeEmail } from "./index.js";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  JAMES.WANJIRU.KIL7488@VG-EVAL.TEST ")).toBe(
      "james.wanjiru.kil7488@vg-eval.test",
    );
  });

  it("collapses the two real conflicting rows for CT-007796 to the same value", () => {
    // docs/DATA_FINDINGS.md — these are the two literal rows on file for CT-007796.
    const a = normalizeEmail("  JAMES.WANJIRU.KIL7488@VG-EVAL.TEST ");
    const b = normalizeEmail("james.wanjiru.kil7488@vg-eval.test");
    expect(a).toBe(b);
  });

  it("treats missing, null, blank and whitespace-only as the same null case", () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("never returns an empty string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = normalizeEmail(s);
        expect(result).not.toBe("");
      }),
    );
  });

  it("is idempotent — normalising twice equals normalising once", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeEmail(s);
        const twice = normalizeEmail(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it("is case-insensitive: normalizing any casing of the same address agrees", () => {
    // Restricted to ASCII: full-Unicode case-folding isn't always its own inverse (e.g. Turkish
    // İ/i, German ß), which would make this property flaky for reasons unrelated to what it's
    // actually testing. Email local-parts in the seed are ASCII, so this is the right domain.
    fc.assert(
      fc.property(fc.asciiString({ minLength: 1 }).filter((s) => s.trim() !== ""), (s) => {
        expect(normalizeEmail(s.toUpperCase())).toBe(normalizeEmail(s.toLowerCase()));
      }),
    );
  });
});
