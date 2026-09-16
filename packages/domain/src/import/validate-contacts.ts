import { decodeFile, detectDelimiter, isBlankRow, parseCsv } from "./csv.js";
import { CONTACT_HEADER_ALIASES, mapHeaders } from "./header-aliases.js";
import {
  isValidEmailShape,
  normalizeConsent,
  normalizeCountry,
  normalizeNotes,
  normalizeNullSentinel,
  normalizePhone,
  normalizeStatus,
  parseSeedDate,
} from "./normalize.js";
import { normalizeEmail } from "../normalize-email.js";
import type { BrandSlug, ImportResult, NormalisedContact, RowIssue } from "./types.js";

const CALLING_CODE: Record<BrandSlug, string> = { kilele: "254", karoo: "27", marrakech: "212" };
const EXTERNAL_ID_RE = /^CT-\d+$/;

function excerpt(v: string | null): string | null {
  if (v === null) return null;
  return v.length > 200 ? v.slice(0, 200) : v;
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function makeIssue(
  rowNumber: number,
  field: string | null,
  value: string | null,
  code: RowIssue["reasonCode"],
  reason: string,
  severity: RowIssue["severity"],
): RowIssue {
  return { rowNumber, field, valueExcerpt: excerpt(value), reasonCode: code, reason, severity };
}

function brandNameCode(slug: BrandSlug): string {
  return slug === "kilele" ? "KILELE" : slug === "karoo" ? "KAROO" : "MARRAKECH";
}

// ------------------------------------------------------------------------------------------
// One small function per rule (or closely related pair of rules) from §2.10. Each is trivially
// low-complexity on its own; validateContactRow below is then a flat sequence of calls, not one
// large branching function — this is a refactor purely for the ESLint complexity gate (§7.4),
// not a behaviour change from the single-function version it replaces.
// ------------------------------------------------------------------------------------------

/** Rule 6: the embedded-header-row signature actually found in the seed (§2.2 S1). */
function checkEmbeddedHeaderRow(mapped: Record<string, string | undefined>, rowNumber: number): RowIssue | null {
  if (mapped.external_id !== "external_id") return null;
  return makeIssue(
    rowNumber,
    null,
    "external_id",
    "EMBEDDED_HEADER_ROW",
    "This row's values equal the column headers — a header line was duplicated as data.",
    "error",
  );
}

/** Rule 8: external_id required and shaped like CT-<digits>. */
function checkExternalId(
  mapped: Record<string, string | undefined>,
  rowNumber: number,
): { externalId: string } | { issue: RowIssue } {
  const externalId = normalizeNullSentinel(mapped.external_id);
  if (externalId !== null && EXTERNAL_ID_RE.test(externalId)) return { externalId };
  return {
    issue: makeIssue(
      rowNumber,
      "external_id",
      mapped.external_id ?? null,
      "BAD_EXTERNAL_ID",
      "external_id is missing or not shaped like CT-<digits>.",
      "error",
    ),
  };
}

/** Rule 9: brand_code, if present, must match the brand being imported. */
function checkBrandCode(
  mapped: Record<string, string | undefined>,
  brandSlug: BrandSlug,
  rowNumber: number,
): RowIssue | null {
  const rawBrandCode = normalizeNullSentinel(mapped.brand_code);
  if (rawBrandCode === null) return null;
  const upper = rawBrandCode.toUpperCase();
  if (upper === brandSlug.toUpperCase() || upper === brandNameCode(brandSlug)) return null;
  return makeIssue(
    rowNumber,
    "brand_code",
    rawBrandCode,
    "BRAND_MISMATCH",
    `brand_code '${rawBrandCode}' does not match the brand being imported.`,
    "error",
  );
}

/** Rule 18/19: signup_at must parse and must not be in the future. */
function checkSignupDate(
  mapped: Record<string, string | undefined>,
  rowNumber: number,
  nowMs: number,
): { date: Date | null } | { issue: RowIssue } {
  const signupRaw = mapped.signup_at;
  const signupDate = parseSeedDate(signupRaw);
  const hadSignupInput = normalizeNullSentinel(signupRaw) !== null;
  if (hadSignupInput && signupDate === null) {
    return {
      issue: makeIssue(
        rowNumber,
        "signup_at",
        signupRaw ?? null,
        "UNPARSEABLE_DATE",
        "signup_at could not be parsed as ISO-8601, a bare date, or DD/MM/YYYY.",
        "error",
      ),
    };
  }
  if (signupDate !== null && signupDate.getTime() > nowMs + 24 * 60 * 60 * 1000) {
    return {
      issue: makeIssue(rowNumber, "signup_at", signupRaw ?? null, "SIGNUP_IN_FUTURE", "signup_at is in the future.", "error"),
    };
  }
  return { date: signupDate };
}

/** Rule 10/11: email — invalid shape or missing is a field-level warning, not a whole-row rejection. */
function resolveEmail(
  mapped: Record<string, string | undefined>,
  rowNumber: number,
): { email: string | null; emailValid: boolean; warning: RowIssue | null } {
  const emailNormalised = normalizeEmail(mapped.email);
  if (emailNormalised === null) {
    return {
      email: null,
      emailValid: false,
      warning: makeIssue(rowNumber, "email", mapped.email ?? null, "MISSING_EMAIL", "No email on file for this contact.", "warning"),
    };
  }
  if (!isValidEmailShape(emailNormalised)) {
    return {
      email: null,
      emailValid: false,
      warning: makeIssue(rowNumber, "email", mapped.email ?? null, "INVALID_EMAIL", "Email does not look like a valid address.", "warning"),
    };
  }
  return { email: emailNormalised, emailValid: true, warning: null };
}

/** Rule 12/13: phone. */
function resolvePhone(mapped: Record<string, string | undefined>, brandSlug: BrandSlug, rowNumber: number) {
  const phone = normalizePhone(mapped.phone, CALLING_CODE[brandSlug]);
  const warning = phone.unrecoverable
    ? makeIssue(rowNumber, "phone", phone.raw, "PHONE_UNRECOVERABLE", "Phone value is mangled beyond recovery (e.g. Excel scientific notation).", "warning")
    : null;
  return { phone, warning };
}

/** Rule 14/15: country. */
function resolveCountry(mapped: Record<string, string | undefined>, rowNumber: number) {
  const country = normalizeCountry(mapped.country);
  const warning = country.unknown
    ? makeIssue(rowNumber, "country", mapped.country ?? null, "UNKNOWN_COUNTRY", "Country value is not a recognised ISO-3166 alpha-2 code.", "warning")
    : null;
  return { country, warning };
}

/** Rule 16: status — an unrecognised value defaults to 'active' with a warning, since the DB
 *  column is NOT NULL and the rule table's "reject field" has to mean something recoverable. */
function resolveStatus(mapped: Record<string, string | undefined>, rowNumber: number) {
  const result = normalizeStatus(mapped.status);
  if (result.unknown) {
    return {
      status: "active" as NormalisedContact["status"],
      warning: makeIssue(rowNumber, "status", mapped.status ?? null, "UNKNOWN_STATUS", "Status value is not recognised; defaulted to active.", "warning"),
    };
  }
  return { status: result.status ?? ("active" as NormalisedContact["status"]), warning: null };
}

/** Rule 20: notes. */
function resolveNotes(mapped: Record<string, string | undefined>, rowNumber: number) {
  const result = normalizeNotes(mapped.notes);
  const warning = result.truncated
    ? makeIssue(rowNumber, "notes", null, "NOTES_TRUNCATED", "Notes exceeded 1,000 characters and were truncated.", "warning")
    : null;
  return { notes: result.notes, warning };
}

/**
 * Validates and normalises one already header-mapped contact row. Returns either a row ready to
 * upsert, or a list of issues explaining why not — a whole-row rejection always has exactly one
 * `severity: "error"` issue; a kept-with-warnings row has zero or more `severity: "warning"`
 * issues and a non-null `row`. Never throws (docs/IMPLEMENTATION_PLAN.md §8 Phase 5: "must never
 * throw on bad input").
 */
export function validateContactRow(
  mapped: Record<string, string | undefined>,
  brandSlug: BrandSlug,
  rowNumber: number,
  nowMs: number = Date.now(),
): { row: NormalisedContact | null; issues: RowIssue[] } {
  const headerIssue = checkEmbeddedHeaderRow(mapped, rowNumber);
  if (headerIssue) return { row: null, issues: [headerIssue] };

  const externalIdResult = checkExternalId(mapped, rowNumber);
  if ("issue" in externalIdResult) return { row: null, issues: [externalIdResult.issue] };

  const brandIssue = checkBrandCode(mapped, brandSlug, rowNumber);
  if (brandIssue) return { row: null, issues: [brandIssue] };

  const signupResult = checkSignupDate(mapped, rowNumber, nowMs);
  if ("issue" in signupResult) return { row: null, issues: [signupResult.issue] };

  const emailResult = resolveEmail(mapped, rowNumber);
  const phoneResult = resolvePhone(mapped, brandSlug, rowNumber);
  const countryResult = resolveCountry(mapped, rowNumber);
  const statusResult = resolveStatus(mapped, rowNumber);
  const notesResult = resolveNotes(mapped, rowNumber);

  const issues = [
    emailResult.warning,
    phoneResult.warning,
    countryResult.warning,
    statusResult.warning,
    notesResult.warning,
  ].filter((w): w is RowIssue => w !== null);

  const row: NormalisedContact = {
    externalId: externalIdResult.externalId,
    fullName: normalizeNullSentinel(mapped.full_name),
    email: emailResult.email,
    emailValid: emailResult.emailValid,
    phoneRaw: phoneResult.phone.raw,
    phoneE164: phoneResult.phone.e164,
    country: countryResult.country.code,
    city: normalizeNullSentinel(mapped.city),
    signupAt: toIso(signupResult.date),
    status: statusResult.status,
    consentMarketing: normalizeConsent(mapped.consent_marketing),
    deletedAt: toIso(parseSeedDate(mapped.deleted_at)),
    suppressedUntil: toIso(parseSeedDate(mapped.suppressed_until)),
    notes: notesResult.notes,
  };

  return { row, issues };
}

/**
 * Parses and validates an entire contacts file. Pure function of (bytes, brand) — no I/O, no
 * Supabase. The Edge Function worker (Phase 5) calls this per chunk of rows; tests call it
 * directly against real seed file bytes.
 */
export function validateContactsFile(buf: Uint8Array, brandSlug: BrandSlug): ImportResult<NormalisedContact> {
  const decoded = decodeFile(buf);
  const delimiter = detectDelimiter(decoded.text);
  const rawRows = parseCsv(decoded.text, delimiter);
  const rawHeader = rawRows[0] ?? [];
  const header = mapHeaders(rawHeader, CONTACT_HEADER_ALIASES);

  const issues: RowIssue[] = [];
  const candidates: { row: NormalisedContact; rowNumber: number }[] = [];
  let blankLineCount = 0;
  const nowMs = Date.now();

  for (let idx = 1; idx < rawRows.length; idx++) {
    const raw = rawRows[idx]!;
    const rowNumber = idx; // 1-based, header excluded — matches the file the marketer uploaded
    if (isBlankRow(raw)) {
      blankLineCount++;
      continue;
    }
    if (raw.length !== header.length) {
      issues.push(
        makeIssue(
          rowNumber,
          null,
          JSON.stringify(raw),
          "COLUMN_COUNT_MISMATCH",
          `Row has ${raw.length} field(s), header has ${header.length}.`,
          "error",
        ),
      );
      continue;
    }
    const mapped: Record<string, string | undefined> = {};
    for (let c = 0; c < header.length; c++) mapped[header[c]!] = raw[c];

    const result = validateContactRow(mapped, brandSlug, rowNumber, nowMs);
    issues.push(...result.issues);
    if (result.row) candidates.push({ row: result.row, rowNumber });
  }

  // Rule 22: duplicate external_id within the file — last occurrence wins, earlier ones warn.
  const lastIndexByExternalId = new Map<string, number>();
  candidates.forEach((c, i) => lastIndexByExternalId.set(c.row.externalId, i));
  const valid: NormalisedContact[] = [];
  candidates.forEach((c, i) => {
    if (lastIndexByExternalId.get(c.row.externalId) !== i) {
      issues.push(
        makeIssue(
          c.rowNumber,
          "external_id",
          c.row.externalId,
          "DUPLICATE_IN_FILE",
          `external_id ${c.row.externalId} appears again later in the file; this occurrence was superseded.`,
          "warning",
        ),
      );
      return;
    }
    valid.push(c.row);
  });

  return {
    valid,
    issues,
    blankLineCount,
    detectedEncoding: decoded.encoding,
    detectedDelimiter: delimiter,
    hadBom: decoded.hadBom,
    totalRows: rawRows.length - 1,
  };
}
