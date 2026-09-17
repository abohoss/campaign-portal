import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyEvent,
  applyEvents,
  deriveConsentMarketing,
  deriveMessageStatus,
  EMPTY_FLAGS,
  type RecipientFlags,
} from "./events.js";
import type { CanonicalEventType } from "./import/validate-events.js";

const EVENT_TYPES: CanonicalEventType[] = ["delivered", "opened", "clicked", "bounced", "unsubscribed", "complained"];

describe("applyEvent", () => {
  it("opened also sets hasDelivered, even if delivered never arrives on its own (real out-of-order case)", () => {
    const flags = applyEvent(EMPTY_FLAGS, "opened");
    expect(flags.hasOpened).toBe(true);
    expect(flags.hasDelivered).toBe(true);
  });

  it.each(EVENT_TYPES.filter((t) => t !== "opened"))("%s never sets an unrelated flag", (type) => {
    const flags = applyEvent(EMPTY_FLAGS, type);
    const trueFlags = Object.values(flags).filter(Boolean).length;
    expect(trueFlags).toBe(1); // exactly the one flag this event type owns
  });
});

describe("events.convergence.prop (§7.3) — the central guarantee of done-rule 7", () => {
  it("any shuffle of the same event-type multiset converges to identical final flags", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...EVENT_TYPES), { minLength: 0, maxLength: 20 }), (events) => {
        const inOrder = applyEvents(EMPTY_FLAGS, events);
        const shuffled = applyEvents(EMPTY_FLAGS, [...events].reverse());
        expect(shuffled).toEqual(inOrder);
      }),
    );
  });

  it("duplicating any event any number of times never changes the final flags", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...EVENT_TYPES), { minLength: 0, maxLength: 10 }),
        fc.integer({ min: 1, max: 5 }),
        (events, duplicationFactor) => {
          const once = applyEvents(EMPTY_FLAGS, events);
          const duplicated = applyEvents(EMPTY_FLAGS, Array(duplicationFactor).fill(events).flat());
          expect(duplicated).toEqual(once);
        },
      ),
    );
  });

  it("applying events is idempotent: applying the same final flags again changes nothing", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...EVENT_TYPES), { minLength: 0, maxLength: 10 }), (events) => {
        const flags = applyEvents(EMPTY_FLAGS, events);
        expect(applyEvents(flags, events)).toEqual(flags);
      }),
    );
  });
});

describe("events.sticky.prop (§7.3): unsubscribed is never reversed by a later opened", () => {
  it("real case: unsubscribed then opened leaves hasUnsubscribed true and consent false", () => {
    const flags = applyEvents(EMPTY_FLAGS, ["unsubscribed", "opened"]);
    expect(flags.hasUnsubscribed).toBe(true);
    expect(deriveConsentMarketing(flags, true)).toBe(false);
  });

  it("once hasUnsubscribed is true, no subsequent event sequence can make deriveConsentMarketing return true again", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...EVENT_TYPES), { minLength: 0, maxLength: 10 }), (laterEvents) => {
        const afterUnsubscribe = applyEvents(EMPTY_FLAGS, ["unsubscribed", ...laterEvents]);
        expect(deriveConsentMarketing(afterUnsubscribe, true)).toBe(false);
      }),
    );
  });
});

describe("deriveMessageStatus", () => {
  it.each<[RecipientFlags, boolean, string]>([
    [EMPTY_FLAGS, false, "pending"],
    [EMPTY_FLAGS, true, "sent"],
    [{ ...EMPTY_FLAGS, hasDelivered: true }, true, "delivered"],
    [{ ...EMPTY_FLAGS, hasDelivered: true, hasOpened: true }, true, "opened"],
    [{ ...EMPTY_FLAGS, hasDelivered: true, hasOpened: true, hasUnsubscribed: true }, true, "unsubscribed"],
    [{ ...EMPTY_FLAGS, hasBounced: true, hasOpened: true, hasUnsubscribed: true }, true, "bounced"],
  ])("precedence %#: -> %s", (flags, wasSent, expected) => {
    expect(deriveMessageStatus(flags, wasSent)).toBe(expected);
  });
});
