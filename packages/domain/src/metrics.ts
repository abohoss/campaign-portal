/**
 * Pure-TS mirror of the SQL in supabase/migrations/0010_metrics.sql (§6 of the plan). Kept in sync
 * by hand — there's no code generation between them — but this is what lets the "contactable" and
 * rate definitions be property-tested without a database, and cross-checked against the live SQL
 * function's real output in tests/integration/metrics.test.ts.
 */

export interface ContactableInput {
  deletedAt: string | null;
  consentMarketing: boolean | null;
  status: "active" | "pending" | "unsubscribed" | "bounced";
  email: string | null;
  emailValid: boolean;
  suppressedUntil: string | null;
  now?: Date;
}

/** §6: consented, not deleted, active/pending, has a valid email, and not currently suppressed.
 *  Blank/unknown consent (`null`) is NOT contactable — unknown is not consent. */
export function isContactable(c: ContactableInput): boolean {
  const now = c.now ?? new Date();
  return (
    c.deletedAt === null &&
    c.consentMarketing === true &&
    (c.status === "active" || c.status === "pending") &&
    c.email !== null &&
    c.emailValid &&
    (c.suppressedUntil === null || new Date(c.suppressedUntil) <= now)
  );
}

/** §6: unique opens ÷ delivered, not ÷ sent. Null (not NaN, not 0) when delivered is 0 or unknown —
 *  "no denominator" is a different fact than "a zero rate". */
export function computeOpenRate(uniqueOpens: number, delivered: number | null): number | null {
  if (delivered === null || delivered <= 0) return null;
  return uniqueOpens / delivered;
}

/** §6: bounced ÷ sent. A null/missing bounced count is treated as 0 (matches the SQL's
 *  `coalesce(reported_bounced, 0)`) — only a missing or zero denominator produces null, not NaN. */
export function computeBounceRate(bounced: number | null, sent: number | null): number | null {
  if (sent === null || sent <= 0) return null;
  return (bounced ?? 0) / sent;
}
