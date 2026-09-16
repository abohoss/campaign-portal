/**
 * Maps every header spelling actually seen across the three brands' contacts files
 * (docs/DATA_FINDINGS.md — regenerate with `npm run profile`) to one canonical field name. An
 * explicit table, not a fuzzy/case-insensitive matcher: with only three known source formats,
 * precision beats generality here — a column we've never seen fails loudly (CONTACT_HEADERS
 * below has no entry for it) rather than being silently guessed at.
 */
export const CONTACT_HEADER_ALIASES: Record<string, string> = {
  // Kilele — lowercase snake_case
  external_id: "external_id",
  full_name: "full_name",
  email: "email",
  phone: "phone",
  country: "country",
  city: "city",
  signup_at: "signup_at",
  status: "status",
  consent_marketing: "consent_marketing",
  deleted_at: "deleted_at",
  suppressed_until: "suppressed_until",
  brand_code: "brand_code",
  notes: "notes",
  // Karoo — Title Case With Spaces (§2.2 F5), different column order too — mapping by header
  // name rather than position is what makes the order difference a non-issue.
  "Full Name": "full_name",
  Email: "email",
  "External Id": "external_id",
  Phone: "phone",
  Country: "country",
  Status: "status",
  City: "city",
  "Signup At": "signup_at",
  "Consent Marketing": "consent_marketing",
  "Brand Code": "brand_code",
  "Deleted At": "deleted_at",
  "Suppressed Until": "suppressed_until",
  Notes: "notes",
  // Marrakech — French field names, semicolon-delimited (§2.2 F1)
  e_mail: "email",
  mobile: "phone",
  pays: "country",
};

export const CAMPAIGN_HEADER_ALIASES: Record<string, string> = {
  external_id: "external_id",
  campaign_name: "campaign_name",
  channel: "channel",
  target_country: "target_country",
  reported_sent: "reported_sent",
  reported_delivered: "reported_delivered",
  reported_bounced: "reported_bounced",
  reported_opens: "reported_opens",
  reported_clicks: "reported_clicks",
  spend: "spend",
  sent_at_utc: "sent_at_utc",
  send_local_time: "send_local_time",
  parent_campaign_id: "parent_campaign_id",
};

/** Maps a raw header row to canonical field names, in the same order. Unrecognised headers pass
 *  through unchanged — the caller decides whether that's fatal (it should be: an unmapped column
 *  means the file format is not one of the three known shapes). */
export function mapHeaders(rawHeaders: string[], aliases: Record<string, string>): string[] {
  return rawHeaders.map((h) => aliases[h] ?? h);
}
