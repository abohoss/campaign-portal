/**
 * CSV parsing and format detection. Same RFC4180-ish parser proven against all 11 seed files in
 * scripts/profile-seed.ts (quoted fields, embedded newlines/delimiters/quotes), reworked as a
 * reusable pure-TS module — this is the production import path; profile-seed.ts stays a one-off
 * analysis script and does not import from here (its job is describing the raw seed, warts
 * included, independently of whatever the import pipeline does with it).
 */

export interface DecodedFile {
  text: string;
  encoding: "utf-8" | "cp1252";
  hadBom: boolean;
}

/** UTF-8 first; cp1252 fallback for files like karoo-contacts.csv that aren't valid UTF-8
 *  (§2.2 F3 — 'Seán O'Connor', 'Ann–Marie Botha'). Never throws — a file that's neither decodes
 *  as cp1252 anyway (that decoder has no invalid byte sequences to reject). */
export function decodeFile(buf: Uint8Array): DecodedFile {
  const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { text: stripBom(text), encoding: "utf-8", hadBom };
  } catch {
    const text = new TextDecoder("windows-1252").decode(buf);
    return { text: stripBom(text), encoding: "cp1252", hadBom };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Sniffs the delimiter from the header line: Marrakech's files use `;`, everything else `,`.
 *  A header with more `;` than `,` is semicolon-delimited; ties and no-signal default to `,`. */
export function detectDelimiter(text: string): "," | ";" {
  const headerLine = text.split(/\r\n|\n/, 1)[0] ?? "";
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

interface ParserState {
  rows: string[][];
  row: string[];
  field: string;
  inQuotes: boolean;
}

function endField(state: ParserState): void {
  state.row.push(state.field);
  state.field = "";
}

function endRow(state: ParserState): void {
  endField(state);
  state.rows.push(state.row);
  state.row = [];
}

/** Handles one character while inside a quoted field: a doubled `"` is an escaped literal quote
 *  (consumes 2 chars); a single `"` closes the field; anything else is literal content. Split out
 *  of parseCsv purely to keep each function's cyclomatic complexity under the ESLint gate (§7.4)
 *  — same parsing behaviour as the single-function version it replaces. */
function consumeQuotedChar(state: ParserState, text: string, i: number): number {
  const c = text[i];
  if (c !== '"') {
    state.field += c;
    return i + 1;
  }
  if (text[i + 1] === '"') {
    state.field += '"';
    return i + 2;
  }
  state.inQuotes = false;
  return i + 1;
}

/** Handles one character outside a quoted field. */
function consumeUnquotedChar(state: ParserState, text: string, i: number, delimiter: string): number {
  const c = text[i];
  if (c === '"') {
    state.inQuotes = true;
    return i + 1;
  }
  if (c === delimiter) {
    endField(state);
    return i + 1;
  }
  if (c === "\r") {
    return i + 1;
  }
  if (c === "\n") {
    endRow(state);
    return i + 1;
  }
  state.field += c;
  return i + 1;
}

export function parseCsv(text: string, delimiter: string): string[][] {
  const state: ParserState = { rows: [], row: [], field: "", inQuotes: false };
  let i = 0;
  while (i < text.length) {
    i = state.inQuotes ? consumeQuotedChar(state, text, i) : consumeUnquotedChar(state, text, i, delimiter);
  }
  if (state.field.length > 0 || state.row.length > 0) endRow(state);

  const lastRow = state.rows[state.rows.length - 1];
  if (lastRow && lastRow.length === 1 && lastRow[0] === "") {
    state.rows.pop(); // trailing EOF newline artifact, not a data row
  }
  return state.rows;
}

/** A row where every field is empty — a genuinely blank line (§2.2), not a short/shifted row.
 *  Skipped silently per import rule 25: counted, never itemised as an import_errors row. */
export function isBlankRow(row: string[]): boolean {
  return row.every((f) => f.trim() === "");
}
