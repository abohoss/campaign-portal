import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeFile, detectDelimiter, isBlankRow, parseCsv } from "./csv.js";

describe("detectDelimiter", () => {
  it("detects comma for Kilele/Karoo-shaped headers", () => {
    expect(detectDelimiter("external_id,full_name,email\nCT-1,A,a@b.test")).toBe(",");
  });
  it("detects semicolon for Marrakech-shaped headers", () => {
    expect(detectDelimiter("external_id;full_name;e_mail\nCT-1;A;a@b.test")).toBe(";");
  });
});

describe("decodeFile", () => {
  it("decodes valid UTF-8 and strips a BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("external_id\nCT-1")]);
    const result = decodeFile(withBom);
    expect(result.encoding).toBe("utf-8");
    expect(result.hadBom).toBe(true);
    expect(result.text.startsWith("external_id")).toBe(true);
  });

  it("falls back to cp1252 for a non-UTF-8 byte sequence (real karoo-contacts.csv byte: 0x96)", () => {
    // "Ann\x96Marie Botha" — 0x96 is cp1252's en-dash, not valid UTF-8 on its own.
    const bytes = new Uint8Array([...Buffer.from("Ann"), 0x96, ...Buffer.from("Marie")]);
    const result = decodeFile(bytes);
    expect(result.encoding).toBe("cp1252");
    expect(result.text).toBe("Ann–Marie");
  });
});

describe("isBlankRow", () => {
  it("is true only when every field is empty", () => {
    expect(isBlankRow([""])).toBe(true);
    expect(isBlankRow(["", "", ""])).toBe(true);
    expect(isBlankRow(["", "x", ""])).toBe(false);
  });
});

describe("parseCsv", () => {
  it("parses a plain comma file", () => {
    expect(parseCsv("a,b,c\n1,2,3", ",")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("parses a semicolon file", () => {
    expect(parseCsv("a;b;c\n1;2;3", ";")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles Windows-style CRLF line endings, not just LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("drops the trailing blank row produced by a file's final newline", () => {
    expect(parseCsv("a,b\n1,2\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles a quoted field containing the delimiter", () => {
    expect(parseCsv('a,b\n"1,1",2', ",")).toEqual([["a", "b"], ["1,1", "2"]]);
  });

  it("handles a quoted field containing an embedded newline (real notes value)", () => {
    const csv = 'external_id,notes\nCT-1,"VIP customer\nfollow up next quarter"';
    expect(parseCsv(csv, ",")).toEqual([
      ["external_id", "notes"],
      ["CT-1", "VIP customer\nfollow up next quarter"],
    ]);
  });

  it("handles an escaped quote inside a quoted field", () => {
    expect(parseCsv('a\n"she said ""hi"""', ",")).toEqual([["a"], ['she said "hi"']]);
  });

  it("drops the trailing blank row from a final newline, but keeps interior blank rows", () => {
    // Real shape: kilele-contacts.csv has 7 interior blank lines plus the usual trailing newline.
    const csv = "a,b\n1,2\n,\n3,4\n";
    expect(parseCsv(csv, ",")).toEqual([["a", "b"], ["1", "2"], ["", ""], ["3", "4"]]);
  });

  it("preserves a short/ragged row rather than padding or dropping it", () => {
    // Real shape: CT-904924 in kilele-contacts.csv has 9 of 13 fields.
    expect(parseCsv("a,b,c\n1,2", ",")).toEqual([["a", "b", "c"], ["1", "2"]]);
  });

  it("round-trips: every row has as many fields as commas+1, for any comma-free field content", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string().filter((s) => !s.includes(",") && !s.includes("\n") && !s.includes('"')), { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 })
          // A trailing row that's a single empty field serialises indistinguishably from "no such
          // row, just a trailing newline" — e.g. rows=[["a"],[""]] and rows=[["a"]] both join to
          // "a\n". Real CSV files treat a trailing newline as just that, not an extra blank row
          // (parseCsv's "drop a single trailing all-empty row" rule, proven correct against real
          // interior blank lines by the test above), so this ambiguity isn't parseCsv's to
          // resolve either way — excluded here rather than asserting a round-trip that isn't one.
          .filter((rows) => {
            const last = rows[rows.length - 1]!; // minLength: 1 guarantees at least one row
            return !(last.length === 1 && last[0] === "");
          }),
        (rows) => {
          const csv = rows.map((r) => r.join(",")).join("\n");
          const parsed = parseCsv(csv, ",");
          expect(parsed.length).toBe(rows.length);
          parsed.forEach((r, i) => expect(r).toEqual(rows[i]));
        },
      ),
    );
  });
});
