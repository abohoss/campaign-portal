/**
 * Shared types for the import pipeline. Pure data — no Supabase, no React, no Node-only APIs
 * (dependency-cruiser enforces packages/domain stays framework-free).
 */

/** The §2.10 reason-code vocabulary from docs/IMPLEMENTATION_PLAN.md — every rejection or
 *  warning carries exactly one of these, never a free-text-only reason. */
export type ReasonCode =
  | "ENCODING_FALLBACK"
  | "COLUMN_COUNT_MISMATCH"
  | "EMBEDDED_HEADER_ROW"
  | "BAD_EXTERNAL_ID"
  | "BRAND_MISMATCH"
  | "INVALID_EMAIL"
  | "MISSING_EMAIL"
  | "PHONE_UNRECOVERABLE"
  | "UNKNOWN_COUNTRY"
  | "UNKNOWN_STATUS"
  | "UNPARSEABLE_DATE"
  | "SIGNUP_IN_FUTURE"
  | "NOTES_TRUNCATED"
  | "DUPLICATE_IN_FILE"
  | "UNKNOWN_CAMPAIGN"
  | "UNKNOWN_CONTACT"
  | "UNKNOWN_RECIPIENT"
  | "UNKNOWN_EVENT_TYPE"
  // Campaign-specific — not part of the original 25-rule contacts vocabulary (§2.10), but the
  // same "reject row with a named reason" discipline extended to the one file type that needed it.
  | "INVALID_CHANNEL"
  | "UNPARSEABLE_NUMBER";

export type Severity = "error" | "warning";

export interface RowIssue {
  /** 1-based, counted against the raw file INCLUDING blank lines — matches what a marketer sees
   *  if they open the CSV themselves (docs/IMPLEMENTATION_PLAN.md §2's addendum). */
  rowNumber: number;
  /** null = whole-row rejection, not one field. */
  field: string | null;
  /** Truncated to 200 chars to match import_errors.value_excerpt's CHECK constraint. */
  valueExcerpt: string | null;
  reasonCode: ReasonCode;
  reason: string;
  severity: Severity;
}

export type BrandSlug = "kilele" | "karoo" | "marrakech";
export const BRAND_PREFIX: Record<BrandSlug, string> = {
  kilele: "KIL",
  karoo: "KAR",
  marrakech: "MAR",
};

export interface NormalisedContact {
  externalId: string;
  fullName: string | null;
  email: string | null;
  emailValid: boolean;
  phoneRaw: string | null;
  phoneE164: string | null;
  country: string | null;
  city: string | null;
  signupAt: string | null; // ISO 8601
  status: "active" | "pending" | "unsubscribed" | "bounced";
  consentMarketing: boolean | null;
  deletedAt: string | null;
  suppressedUntil: string | null;
  notes: string | null;
}

export interface NormalisedCampaign {
  externalId: string;
  name: string;
  channel: "email" | "sms";
  targetCountry: string | null;
  reportedSent: number | null;
  reportedDelivered: number | null;
  reportedBounced: number | null;
  reportedOpens: number | null;
  reportedClicks: number | null;
  spend: number | null;
  sentAt: string | null;
  parentExternalId: string | null;
}

export interface ImportResult<T> {
  valid: T[];
  issues: RowIssue[];
  /** Rows whose every field was empty — skipped silently per §2.10 rule 25, counted but never
   *  itemised as an import_errors row. */
  blankLineCount: number;
  detectedEncoding: string;
  detectedDelimiter: string;
  hadBom: boolean;
  /** Total data rows in the file, header excluded, blank lines included — for "processed_rows". */
  totalRows: number;
}
