import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeBounceRate, computeOpenRate, isContactable, type ContactableInput } from "./metrics.js";

const NOW = new Date("2026-09-16T00:00:00Z");

describe("isContactable", () => {
  it("AC-NUM: a fully clean, consented, active row is contactable", () => {
    expect(
      isContactable({
        deletedAt: null,
        consentMarketing: true,
        status: "active",
        email: "a@vg-eval.test",
        emailValid: true,
        suppressedUntil: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("blank/unknown consent (null) is NOT contactable — unknown is not consent", () => {
    expect(
      isContactable({
        deletedAt: null,
        consentMarketing: null,
        status: "active",
        email: "a@vg-eval.test",
        emailValid: true,
        suppressedUntil: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("a suppression that has already expired does not block contactability", () => {
    expect(
      isContactable({
        deletedAt: null,
        consentMarketing: true,
        status: "active",
        email: "a@vg-eval.test",
        emailValid: true,
        suppressedUntil: "2026-01-01T00:00:00Z",
        now: NOW,
      }),
    ).toBe(true);
  });

  it("a suppression still in the future blocks contactability (real profile: 481 Kilele rows)", () => {
    expect(
      isContactable({
        deletedAt: null,
        consentMarketing: true,
        status: "active",
        email: "a@vg-eval.test",
        emailValid: true,
        suppressedUntil: "2027-01-01T00:00:00Z",
        now: NOW,
      }),
    ).toBe(false);
  });

  it.each(["unsubscribed", "bounced"] as const)("status=%s is never contactable regardless of consent", (status) => {
    expect(
      isContactable({
        deletedAt: null,
        consentMarketing: true,
        status,
        email: "a@vg-eval.test",
        emailValid: true,
        suppressedUntil: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("metrics.contactable.prop: deleted or consent!=true or bad email always yields false", () => {
    fc.assert(
      fc.property(
        fc.record({
          deletedAt: fc.option(fc.constant("2026-01-01T00:00:00Z"), { nil: null }),
          consentMarketing: fc.option(fc.boolean(), { nil: null }),
          status: fc.constantFrom<ContactableInput["status"]>("active", "pending", "unsubscribed", "bounced"),
          email: fc.option(fc.constant("a@vg-eval.test"), { nil: null }),
          emailValid: fc.boolean(),
          suppressedUntil: fc.option(fc.constantFrom("2020-01-01T00:00:00Z", "2099-01-01T00:00:00Z"), { nil: null }),
        }),
        (input: ContactableInput) => {
          const result = isContactable({ ...input, now: NOW });
          if (
            input.deletedAt !== null ||
            input.consentMarketing !== true ||
            input.email === null ||
            !input.emailValid ||
            (input.status !== "active" && input.status !== "pending")
          ) {
            expect(result).toBe(false);
          }
        },
      ),
    );
  });
});

describe("computeOpenRate", () => {
  it("§6: unique opens ÷ delivered, not ÷ sent", () => {
    expect(computeOpenRate(50, 200)).toBeCloseTo(0.25);
  });

  it("a zero or null denominator yields null, never NaN or a divide-by-zero", () => {
    expect(computeOpenRate(50, 0)).toBeNull();
    expect(computeOpenRate(50, null)).toBeNull();
    expect(computeOpenRate(0, null)).toBeNull();
  });

  it("metrics.openrate.prop: result is always in [0, 1] or null, never NaN", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100_000 }),
        fc.option(fc.integer({ min: -10, max: 200_000 }), { nil: null }),
        (opens, delivered) => {
          const rate = computeOpenRate(opens, delivered);
          if (rate === null) {
            expect(delivered === null || delivered <= 0).toBe(true);
          } else {
            expect(Number.isNaN(rate)).toBe(false);
            expect(rate).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});

describe("computeBounceRate", () => {
  it("§6: bounced ÷ sent", () => {
    expect(computeBounceRate(10, 200)).toBeCloseTo(0.05);
  });

  it("a missing bounced count is treated as 0, matching the SQL's coalesce", () => {
    expect(computeBounceRate(null, 200)).toBe(0);
  });

  it("a zero or null sent denominator yields null", () => {
    expect(computeBounceRate(10, 0)).toBeNull();
    expect(computeBounceRate(10, null)).toBeNull();
  });
});
