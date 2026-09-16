import { decodeFile, detectDelimiter, isBlankRow, parseCsv } from "./csv.js";
import { CAMPAIGN_HEADER_ALIASES, mapHeaders } from "./header-aliases.js";
import { normalizeNullSentinel, normalizeSpend, parseSeedDate } from "./normalize.js";
import type { BrandSlug, ImportResult, NormalisedCampaign, RowIssue } from "./types.js";
import { BRAND_PREFIX } from "./types.js";

const EXTERNAL_ID_RE = /^(KIL|KAR|MAR|CMP)-\d+$/;

function excerpt(v: string | null): string | null {
  if (v === null) return null;
  return v.length > 200 ? v.slice(0, 200) : v;
}

function prefixOf(id: string): string | null {
  const m = /^([A-Z]+)-/.exec(id);
  return m ? m[1]! : null;
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

/** Rule 8 (campaign shape): external_id required and shaped like a known prefix + digits. */
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
      "external_id is missing or not shaped like KIL-/KAR-/MAR-/CMP-<digits>.",
      "error",
    ),
  };
}

/** The one campaign-specific rule beyond the shared vocabulary: a `parent_campaign_id` whose
 *  prefix doesn't match the brand being imported is the actual contamination signal in the seed
 *  (§2.4/§2.6 — Karoo's `CMP-014` has `parent_campaign_id='KIL-0007'`, a Kilele reference sitting
 *  inside Karoo's own file). There is no `brand_code` column on campaigns to check directly,
 *  unlike contacts. */
function checkParentCampaign(
  mapped: Record<string, string | undefined>,
  brandSlug: BrandSlug,
  rowNumber: number,
): { parentId: string | null } | { issue: RowIssue } {
  const parentId = normalizeNullSentinel(mapped.parent_campaign_id);
  if (parentId === null) return { parentId: null };
  const parentPrefix = prefixOf(parentId);
  if (parentPrefix === null || parentPrefix === BRAND_PREFIX[brandSlug] || parentPrefix === "CMP") {
    return { parentId };
  }
  return {
    issue: makeIssue(
      rowNumber,
      "parent_campaign_id",
      parentId,
      "BRAND_MISMATCH",
      `parent_campaign_id '${parentId}' references another brand's campaign (expected prefix ${BRAND_PREFIX[brandSlug]}).`,
      "error",
    ),
  };
}

function checkChannel(
  mapped: Record<string, string | undefined>,
  rowNumber: number,
): { channel: "email" | "sms" } | { issue: RowIssue } {
  const channel = (mapped.channel ?? "").trim().toLowerCase();
  if (channel === "email" || channel === "sms") return { channel };
  return {
    issue: makeIssue(rowNumber, "channel", mapped.channel ?? null, "INVALID_CHANNEL", "channel must be 'email' or 'sms'.", "error"),
  };
}

function toInt(v: string | undefined): number | null {
  const cleaned = normalizeNullSentinel(v);
  if (cleaned === null) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Validates one header-mapped campaign row.
 */
export function validateCampaignRow(
  mapped: Record<string, string | undefined>,
  brandSlug: BrandSlug,
  rowNumber: number,
): { row: NormalisedCampaign | null; issues: RowIssue[] } {
  const externalIdResult = checkExternalId(mapped, rowNumber);
  if ("issue" in externalIdResult) return { row: null, issues: [externalIdResult.issue] };

  const parentResult = checkParentCampaign(mapped, brandSlug, rowNumber);
  if ("issue" in parentResult) return { row: null, issues: [parentResult.issue] };

  const channelResult = checkChannel(mapped, rowNumber);
  if ("issue" in channelResult) return { row: null, issues: [channelResult.issue] };

  const sentAt = parseSeedDate(mapped.sent_at_utc);
  const spend = normalizeSpend(mapped.spend); // rule 21: decimal-comma (Marrakech)

  const row: NormalisedCampaign = {
    externalId: externalIdResult.externalId,
    name: normalizeNullSentinel(mapped.campaign_name) ?? externalIdResult.externalId,
    channel: channelResult.channel,
    targetCountry: normalizeNullSentinel(mapped.target_country),
    reportedSent: toInt(mapped.reported_sent),
    reportedDelivered: toInt(mapped.reported_delivered),
    reportedBounced: toInt(mapped.reported_bounced),
    reportedOpens: toInt(mapped.reported_opens),
    reportedClicks: toInt(mapped.reported_clicks),
    spend,
    sentAt: sentAt ? sentAt.toISOString() : null,
    parentExternalId: parentResult.parentId,
  };

  const issues: RowIssue[] = [];
  if (mapped.spend && spend === null) {
    issues.push(makeIssue(rowNumber, "spend", mapped.spend, "UNPARSEABLE_NUMBER", "spend could not be parsed as a number.", "warning"));
  }

  return { row, issues };
}

export function validateCampaignsFile(buf: Uint8Array, brandSlug: BrandSlug): ImportResult<NormalisedCampaign> {
  const decoded = decodeFile(buf);
  const delimiter = detectDelimiter(decoded.text);
  const rawRows = parseCsv(decoded.text, delimiter);
  const rawHeader = rawRows[0] ?? [];
  const header = mapHeaders(rawHeader, CAMPAIGN_HEADER_ALIASES);

  const issues: RowIssue[] = [];
  const candidates: { row: NormalisedCampaign; rowNumber: number }[] = [];
  let blankLineCount = 0;

  for (let idx = 1; idx < rawRows.length; idx++) {
    const raw = rawRows[idx]!;
    const rowNumber = idx;
    if (isBlankRow(raw)) {
      blankLineCount++;
      continue;
    }
    if (raw.length !== header.length) {
      issues.push(
        makeIssue(rowNumber, null, JSON.stringify(raw), "COLUMN_COUNT_MISMATCH", `Row has ${raw.length} field(s), header has ${header.length}.`, "error"),
      );
      continue;
    }
    const mapped: Record<string, string | undefined> = {};
    for (let c = 0; c < header.length; c++) mapped[header[c]!] = raw[c];

    const result = validateCampaignRow(mapped, brandSlug, rowNumber);
    issues.push(...result.issues);
    if (result.row) candidates.push({ row: result.row, rowNumber });
  }

  // Duplicate external_id within file — last wins (Kilele: CMP-014 and KIL-0044 each appear
  // twice, byte-identical — so which one "wins" doesn't change the outcome, but the rule is the
  // same either way).
  const lastIndexByExternalId = new Map<string, number>();
  candidates.forEach((c, i) => lastIndexByExternalId.set(c.row.externalId, i));
  const valid: NormalisedCampaign[] = [];
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
