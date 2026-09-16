/**
 * Normalises a raw email value the way the import pipeline must before comparing or
 * deduplicating on it.
 *
 * See docs/IMPLEMENTATION_PLAN.md §2.3: every *conflicting* duplicate `external_id` in the seed
 * (368 in kilele-contacts.csv, 72 in karoo-contacts.csv) differs only by email case and/or
 * surrounding whitespace — e.g. `'  JAMES.WANJIRU.KIL7488@VG-EVAL.TEST '` vs
 * `'james.wanjiru.kil7488@vg-eval.test'` for the same contact `CT-007796`. Normalising before
 * comparison is what makes `UNIQUE(brand_id, external_id)` + `ON CONFLICT DO UPDATE` genuinely
 * idempotent (import rule #10, §2.10).
 *
 * Returns `null` for a value that normalises to nothing (missing, blank, or whitespace-only),
 * never an empty string — callers can then treat "no email" as one unambiguous case rather than
 * juggling `''` and `null` separately.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}
