/**
 * Pure-TS mirror of the monotonic-flag precedence logic in ingest_provider_events
 * (supabase/migrations/0007_events.sql, §5.7). Proves the convergence guarantee (done-rule 7)
 * without a database: any shuffle and any duplication of the same event-type multiset applied
 * through applyEvent/applyEvents produces byte-identical flags, because every flag is a pure
 * monotonic OR — order and repetition can never un-set anything.
 */

import type { CanonicalEventType } from "./import/validate-events.js";

export interface RecipientFlags {
  hasDelivered: boolean;
  hasOpened: boolean;
  hasClicked: boolean;
  hasBounced: boolean;
  hasUnsubscribed: boolean;
  hasComplained: boolean;
}

export const EMPTY_FLAGS: RecipientFlags = {
  hasDelivered: false,
  hasOpened: false,
  hasClicked: false,
  hasBounced: false,
  hasUnsubscribed: false,
  hasComplained: false,
};

/** opened also sets hasDelivered — an "opened" that arrives before its own "delivered" (a real,
 *  expected ordering under §2.7's "duplicated and out of order") still leaves delivered true. */
export function applyEvent(flags: RecipientFlags, type: CanonicalEventType): RecipientFlags {
  switch (type) {
    case "delivered":
      return { ...flags, hasDelivered: true };
    case "opened":
      return { ...flags, hasOpened: true, hasDelivered: true };
    case "clicked":
      return { ...flags, hasClicked: true };
    case "bounced":
      return { ...flags, hasBounced: true };
    case "unsubscribed":
      return { ...flags, hasUnsubscribed: true };
    case "complained":
      return { ...flags, hasComplained: true };
  }
}

export function applyEvents(flags: RecipientFlags, types: CanonicalEventType[]): RecipientFlags {
  return types.reduce(applyEvent, flags);
}

export type MessageStatus = "pending" | "sent" | "delivered" | "opened" | "unsubscribed" | "bounced";

/** §5.6's precedence: bounced > unsubscribed > opened > delivered > sent > pending. */
export function deriveMessageStatus(flags: RecipientFlags, wasSent: boolean): MessageStatus {
  if (flags.hasBounced) return "bounced";
  if (flags.hasUnsubscribed) return "unsubscribed";
  if (flags.hasOpened) return "opened";
  if (flags.hasDelivered) return "delivered";
  return wasSent ? "sent" : "pending";
}

/** §5.7 step 6: unsubscribed => consent_marketing=false, sticky. Modelled on the same flags this
 *  module already proves are monotonic, so "sticky" falls out of that proof rather than needing a
 *  separate one — a later "opened" can never flip hasUnsubscribed back to false, so this can never
 *  return true once it has returned false for the same flags lineage. */
export function deriveConsentMarketing(flags: RecipientFlags, priorConsent: boolean | null): boolean | null {
  return flags.hasUnsubscribed ? false : priorConsent;
}
