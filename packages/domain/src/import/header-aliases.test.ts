import { describe, expect, it } from "vitest";
import { CONTACT_HEADER_ALIASES, mapHeaders } from "./header-aliases.js";

describe("mapHeaders", () => {
  it("maps a known alias to its canonical name (real Karoo header: 'External Id')", () => {
    expect(mapHeaders(["External Id", "Email"], CONTACT_HEADER_ALIASES)).toEqual(["external_id", "email"]);
  });

  it("maps a real Marrakech French header ('e_mail', 'mobile', 'pays')", () => {
    expect(mapHeaders(["e_mail", "mobile", "pays"], CONTACT_HEADER_ALIASES)).toEqual(["email", "phone", "country"]);
  });

  it("passes an unrecognised header through unchanged, for the caller to reject", () => {
    expect(mapHeaders(["totally_unknown_column"], CONTACT_HEADER_ALIASES)).toEqual(["totally_unknown_column"]);
  });
});
