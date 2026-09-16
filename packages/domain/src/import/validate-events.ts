import { decodeFile, detectDelimiter, isBlankRow, parseCsv } from "./csv.js";
import { normalizeNullSentinel, parseSeedDate } from "./normalize.js";
import type { RowIssue } from "./types.js";

/** The canonical vocabulary the app stores events as (matches public.event_type in
 *  0001_extensions.sql). §2.7: the seed uses bare verbs (open/click/bounce/unsubscribe/complaint)
 *  while the live provider uses past participles (delivered/opened/bounced/unsubscribed) with no
 *  `click`/`complaint` at all and no seed event is ever `delivered` — this mapping is the
 *  boundary that reconciles the two vocabularies into one. */
export type CanonicalEventType = "delivered" | "opened" | "clicked" | "bounced" | "unsubscribed" | "complained";

const SEED_EVENT_TYPE_MAP: Record<string, CanonicalEventType> = {
  open: "opened",
  click: "clicked",
  bounce: "bounced",
  unsubscribe: "unsubscribed",
  complaint: "complained",
  // Also accept the provider's own vocabulary directly, in case this validator is ever reused
  // for live provider events (Phase 8), not just the historical seed.
  delivered: "delivered",
  opened: "opened",
  bounced: "bounced",
  unsubscribed: "unsubscribed",
};

export interface NormalisedEvent {
  externalContactId: string;
  campaignExternalId: string;
  providerEventId: string;
  eventType: CanonicalEventType;
  channel: string | null;
  occurredAt: string; // ISO 8601
}

export interface EventValidationResult {
  valid: NormalisedEvent[];
  issues: RowIssue[];
  blankLineCount: number;
  totalRows: number;
}

function excerpt(v: string | null): string | null {
  return v && v.length > 200 ? v.slice(0, 200) : v;
}

function makeIssue(
  rowNumber: number,
  field: string | null,
  value: string | null,
  code: RowIssue["reasonCode"],
  reason: string,
): RowIssue {
  return { rowNumber, field, valueExcerpt: excerpt(value), reasonCode: code, reason, severity: "warning" };
}

interface RequiredFields {
  providerEventId: string;
  externalContactId: string;
  campaignExternalId: string;
  rawEventType: string;
  occurredAt: Date;
}

function checkRequiredFields(mapped: Record<string, string | undefined>, rowNumber: number): RequiredFields | RowIssue {
  const providerEventId = normalizeNullSentinel(mapped.event_id);
  const externalContactId = normalizeNullSentinel(mapped.external_contact_id);
  const campaignExternalId = normalizeNullSentinel(mapped.campaign_external_id);
  const rawEventType = normalizeNullSentinel(mapped.event_type);
  const occurredAt = parseSeedDate(mapped.occurred_at_utc);

  if (providerEventId && externalContactId && campaignExternalId && rawEventType && occurredAt) {
    return { providerEventId, externalContactId, campaignExternalId, rawEventType, occurredAt };
  }
  return {
    rowNumber,
    field: null,
    valueExcerpt: excerpt(JSON.stringify(mapped)),
    reasonCode: "UNPARSEABLE_DATE",
    reason: "Missing a required field (event_id, contact id, campaign id, event_type, or occurred_at).",
    severity: "error",
  };
}

/** Rules 23/24 (§2.10): an event referencing an unknown campaign or contact is quarantined, not
 *  dropped and not silently linked to the wrong thing. Resolution happens here in pure TS (no DB
 *  access) — the caller supplies the id sets it already fetched. */
function validateEventRow(
  mapped: Record<string, string | undefined>,
  rowNumber: number,
  knownContactIds: ReadonlySet<string>,
  knownCampaignIds: ReadonlySet<string>,
): NormalisedEvent | RowIssue {
  const required = checkRequiredFields(mapped, rowNumber);
  if ("reasonCode" in required) return required;

  const { providerEventId, externalContactId, campaignExternalId, rawEventType, occurredAt } = required;

  if (!knownContactIds.has(externalContactId)) {
    return makeIssue(rowNumber, "external_contact_id", externalContactId, "UNKNOWN_CONTACT", `No contact with external_id '${externalContactId}' in this brand.`);
  }
  if (!knownCampaignIds.has(campaignExternalId)) {
    return makeIssue(rowNumber, "campaign_external_id", campaignExternalId, "UNKNOWN_CAMPAIGN", `No campaign with external_id '${campaignExternalId}' in this brand.`);
  }
  const eventType = SEED_EVENT_TYPE_MAP[rawEventType.toLowerCase()];
  if (!eventType) {
    return makeIssue(rowNumber, "event_type", rawEventType, "UNKNOWN_EVENT_TYPE", `Unrecognised event_type '${rawEventType}'.`);
  }

  return {
    externalContactId,
    campaignExternalId,
    providerEventId,
    eventType,
    channel: normalizeNullSentinel(mapped.channel),
    occurredAt: occurredAt.toISOString(),
  };
}

export function validateEventsFile(
  buf: Uint8Array,
  knownContactIds: ReadonlySet<string>,
  knownCampaignIds: ReadonlySet<string>,
): EventValidationResult {
  const decoded = decodeFile(buf);
  const delimiter = detectDelimiter(decoded.text);
  const rawRows = parseCsv(decoded.text, delimiter);
  const header = rawRows[0] ?? [];

  const issues: RowIssue[] = [];
  const valid: NormalisedEvent[] = [];
  let blankLineCount = 0;

  for (let idx = 1; idx < rawRows.length; idx++) {
    const raw = rawRows[idx]!;
    const rowNumber = idx;
    if (isBlankRow(raw)) {
      blankLineCount++;
      continue;
    }
    if (raw.length !== header.length) {
      issues.push({
        rowNumber,
        field: null,
        valueExcerpt: excerpt(JSON.stringify(raw)),
        reasonCode: "COLUMN_COUNT_MISMATCH",
        reason: `Row has ${raw.length} field(s), header has ${header.length}.`,
        severity: "error",
      });
      continue;
    }
    const mapped: Record<string, string | undefined> = {};
    for (let c = 0; c < header.length; c++) mapped[header[c]!] = raw[c];

    const result = validateEventRow(mapped, rowNumber, knownContactIds, knownCampaignIds);
    if ("reasonCode" in result) issues.push(result);
    else valid.push(result);
  }

  return { valid, issues, blankLineCount, totalRows: rawRows.length - 1 };
}
