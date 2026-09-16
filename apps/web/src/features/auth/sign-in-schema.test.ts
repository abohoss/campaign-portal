import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { signInSchema } from "./sign-in-schema.js";

describe("signInSchema", () => {
  it("accepts a well-formed email and non-empty password", () => {
    const result = signInSchema.safeParse({ email: "owner@vg-eval.test", password: "hunter2" });
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace from the email", () => {
    const result = signInSchema.safeParse({ email: "  owner@vg-eval.test  ", password: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("owner@vg-eval.test");
  });

  it("rejects a malformed email", () => {
    const result = signInSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty email", () => {
    const result = signInSchema.safeParse({ email: "", password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = signInSchema.safeParse({ email: "owner@vg-eval.test", password: "" });
    expect(result.success).toBe(false);
  });

  it("never accepts a string with no '@' as a valid email", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !s.includes("@")),
        (notAnEmail) => {
          const result = signInSchema.safeParse({ email: notAnEmail, password: "x" });
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});
