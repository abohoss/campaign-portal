/**
 * scripts/profile-seed.ts
 *
 * Profiles every file in seed/ and regenerates docs/DATA_FINDINGS.md with live numbers.
 * This is the evidence behind §2 "Data findings" of docs/IMPLEMENTATION_PLAN.md — every
 * claim in that section should be reproducible by running:
 *
 *   npm run profile
 *
 * Before profiling anything, it verifies every seed file's SHA-256 against
 * scripts/seed-manifest.ts (captured after verifying the seed zip's hash against the one
 * published in the case study brief) and fails loudly on any mismatch, so a corrupted or
 * substituted seed file is caught before the numbers below are trusted.
 *
 * This script is read-only profiling, not the import pipeline. It intentionally does its
 * own lightweight CSV parsing rather than importing packages/domain — packages/domain
 * (Phase 2+) is pure validation/normalisation logic with its own tests, and this script's
 * job is only to describe the raw seed, warts included, as evidence for the plan.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_FILE_SHA256 } from "./seed-manifest.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SEED_DIR = join(REPO_ROOT, "seed");
const OUT_PATH = join(REPO_ROOT, "docs", "DATA_FINDINGS.md");

// ---------------------------------------------------------------------------
// 0. Integrity gate — fail loudly before profiling an untrusted file.
// ---------------------------------------------------------------------------

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function verifySeedIntegrity(): void {
  const expectedNames = Object.keys(SEED_FILE_SHA256).sort();
  const actualNames = readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".csv"))
    .sort();

  const missing = expectedNames.filter((f) => !actualNames.includes(f));
  const unexpected = actualNames.filter((f) => !expectedNames.includes(f));
  if (missing.length > 0) {
    throw new Error(
      `Seed integrity check FAILED: missing file(s) in seed/: ${missing.join(", ")}`,
    );
  }
  if (unexpected.length > 0) {
    console.warn(
      `WARNING: seed/ contains file(s) not in the manifest (ignored): ${unexpected.join(", ")}`,
    );
  }

  const mismatches: string[] = [];
  for (const name of expectedNames) {
    const actual = sha256(readFileSync(join(SEED_DIR, name)));
    const expected = SEED_FILE_SHA256[name];
    if (actual !== expected) {
      mismatches.push(`  ${name}\n    expected ${expected}\n    actual   ${actual}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Seed integrity check FAILED — file contents do not match the known-good hash.\n` +
        `This seed has been modified since it was verified against the case study's published\n` +
        `SHA-256 (4961a25b151ca13ac56089ca46b94def6074c315445ec193c7bf87060683d35c). Refusing to\n` +
        `profile it:\n${mismatches.join("\n")}`,
    );
  }
  console.log(`Seed integrity OK — ${expectedNames.length} files match the known-good manifest.`);
}

// ---------------------------------------------------------------------------
// 1. Minimal RFC4180-ish CSV parser (quoted fields, embedded newlines/delimiters/quotes).
//    Whole-file parsing is fine at this scale (largest file is 22MB) and correctness on
//    the embedded-newline notes rows (§2.5) matters more than streaming here.
// ---------------------------------------------------------------------------

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // trailing field/row if the file doesn't end with a newline
  if (field.length > 0 || row.length > 0) endRow();
  // drop a single trailing all-empty row from a final newline
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

function decode(buf: Buffer): { text: string; encoding: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { text: stripBom(text), encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(buf);
    return { text: stripBom(text), encoding: "cp1252 (FALLBACK — not valid UTF-8)" };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

interface Table {
  file: string;
  delimiter: string;
  encoding: string;
  hadBom: boolean;
  header: string[];
  rows: Record<string, string>[];
  raggedCount: number;
  raggedExamples: { index: number; row: string[] }[];
  blankLineCount: number;
  blankLineRows: number[]; // 1-based row numbers (matching what a marketer would see), trailing EOF newline excluded
}

/** A row where every field is empty — a genuinely blank line in the file, distinct from a
 *  short/shifted data row (§2.2 S2/S3/S4). csv.DictReader-style readers skip these silently,
 *  which is exactly why the original pass missed them: see docs/DATA_FINDINGS.md. */
function isBlankRow(r: string[]): boolean {
  return r.every((f) => f.trim() === "");
}

function loadTable(file: string, delimiter: string): Table {
  const buf = readFileSync(join(SEED_DIR, file));
  const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const { text, encoding } = decode(buf);
  const raw = parseCsv(text, delimiter);
  const header = raw[0];
  const rows: Record<string, string>[] = [];
  const raggedExamples: { index: number; row: string[] }[] = [];
  let raggedCount = 0;
  const blankLineRows: number[] = [];

  // The file's very last row is dropped only when it is both blank AND the last line (the
  // trailing newline every well-formed file ends with) — that one is not a data-quality
  // finding. Any *other* blank row, however many, is real and gets counted below.
  const lastIdx = raw.length - 1;
  const trailingIsBlank = lastIdx >= 1 && isBlankRow(raw[lastIdx]);

  for (let idx = 1; idx < raw.length; idx++) {
    if (idx === lastIdx && trailingIsBlank) continue; // final-newline artifact, not a data row
    const r = raw[idx];
    const rowNumber = idx; // 1-based, excluding the header — matches what a marketer's row count means
    if (isBlankRow(r)) {
      blankLineRows.push(rowNumber);
      continue;
    }
    if (r.length !== header.length) {
      raggedCount++;
      if (raggedExamples.length < 5) raggedExamples.push({ index: rowNumber, row: r });
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = r[c] ?? "";
    rows.push(obj);
  }
  return {
    file,
    delimiter,
    encoding,
    hadBom,
    header,
    rows,
    raggedCount,
    raggedExamples,
    blankLineCount: blankLineRows.length,
    blankLineRows,
  };
}

// ---------------------------------------------------------------------------
// 2. Small analysis helpers
// ---------------------------------------------------------------------------

function counter(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function topN(m: Map<string, number>, n: number): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function nonEmpty(v: string | undefined): boolean {
  return !!v && v.trim() !== "";
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

function isValidEmailStrict(v: string): boolean {
  return EMAIL_RE.test(v);
}

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/;

/** Parses the three signup_at shapes seen in the seed (§2.5): ISO ts, date-only, DD/MM/YYYY. */
function parseSeedDate(v: string): Date | null {
  if (!v) return null;
  if (ISO_TS_RE.test(v)) {
    const d = new Date(v.endsWith("Z") ? v : v.replace(" ", "T") + "Z");
    return isNaN(d.getTime()) ? null : d;
  }
  if (ISO_DATE_RE.test(v)) {
    const d = new Date(v + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }
  const m = DMY_RE.exec(v);
  if (m) {
    const [, dd, mm, yyyy, hh, min] = m;
    const d = new Date(
      `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh ?? "00"}:${min ?? "00"}:00Z`,
    );
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Report builder — collects markdown sections, then writes docs/DATA_FINDINGS.md
// ---------------------------------------------------------------------------

const out: string[] = [];
function P(line = ""): void {
  out.push(line);
}

function reportFile(t: Table): void {
  P(`### \`${t.file}\``);
  P();
  P(
    `- rows: **${fmtInt(t.rows.length)}** &nbsp;·&nbsp; columns: **${t.header.length}** &nbsp;·&nbsp; ` +
      `delimiter: \`${t.delimiter === ";" ? ";" : ","}\` &nbsp;·&nbsp; encoding: **${t.encoding}**` +
      `${t.hadBom ? " &nbsp;·&nbsp; **UTF-8 BOM present**" : ""}`,
  );
  P(`- columns: \`${t.header.join(", ")}\``);
  if (t.raggedCount > 0) {
    P(
      `- **${fmtInt(t.raggedCount)} ragged row(s)** (field count ≠ header count, not blank). Example (row ${
        t.raggedExamples[0].index
      }): \`${JSON.stringify(t.raggedExamples[0].row)}\``,
    );
  }
  if (t.blankLineCount > 0) {
    P(
      `- **${fmtInt(t.blankLineCount)} blank line(s) mid-file** (every field empty — not the trailing ` +
        `EOF newline). Row number(s): ${t.blankLineRows.slice(0, 10).map(fmtInt).join(", ")}` +
        `${t.blankLineRows.length > 10 ? ", …" : ""}. A \`csv.DictReader\`-style parser skips these ` +
        `silently, which is why the first profiling pass missed them.`,
    );
  }
  P();
}

function reportColumn(
  t: Table,
  col: string,
  opts: { showValues?: boolean; isEmail?: boolean; isPhone?: boolean; isDate?: boolean } = {},
): void {
  const vals = t.rows.map((r) => r[col] ?? "");
  const nn = vals.filter(nonEmpty);
  const nulls = vals.length - nn.length;
  const uniq = new Set(nn).size;
  P(
    `- **${col}** — null: ${fmtInt(nulls)} (${((nulls / Math.max(1, vals.length)) * 100).toFixed(
      1,
    )}%), distinct: ${fmtInt(uniq)}`,
  );

  if (opts.showValues && uniq > 0 && uniq <= 25) {
    const c = counter(nn);
    const parts = topN(c, 25).map(([k, n]) => `\`${k === "" ? "∅" : k}\`=${fmtInt(n)}`);
    P(`  - values: ${parts.join(", ")}`);
  }

  if (opts.isEmail) {
    const bad = nn.filter((v) => !isValidEmailStrict(v));
    const dupCi = counter(nn.map((v) => v.trim().toLowerCase()));
    const dupCount = [...dupCi.values()].filter((n) => n > 1).length;
    P(
      `  - invalid shape: ${fmtInt(bad.length)} (e.g. ${bad
        .slice(0, 4)
        .map((v) => JSON.stringify(v))
        .join(", ")})`,
    );
    P(`  - case/whitespace-insensitive duplicate addresses: ${fmtInt(dupCount)}`);
  }

  if (opts.isPhone) {
    const shapes = counter(nn.map((v) => v.trim().replace(/\d/g, "9")));
    P(`  - shapes: ${topN(shapes, 8).map(([k, n]) => `\`${k}\`=${fmtInt(n)}`).join(", ")}`);
  }

  if (opts.isDate) {
    const parsed = nn.map(parseSeedDate).filter((d): d is Date => d !== null);
    const unparseable = nn.length - parsed.length;
    if (parsed.length > 0) {
      const sorted = [...parsed].sort((a, b) => a.getTime() - b.getTime());
      P(
        `  - parsed range: ${sorted[0].toISOString().slice(0, 10)} .. ${sorted[
          sorted.length - 1
        ]
          .toISOString()
          .slice(0, 10)} &nbsp;·&nbsp; unparseable: ${fmtInt(unparseable)}`,
      );
    }
  }
}

function reportDupKey(t: Table, key: string): { identical: number; conflicting: number } {
  const byKey = new Map<string, Record<string, string>[]>();
  for (const r of t.rows) {
    const k = r[key];
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const dupKeys = [...byKey.entries()].filter(([, rs]) => rs.length > 1);
  let identical = 0;
  let conflicting = 0;
  for (const [, rs] of dupKeys) {
    const sigs = new Set(rs.map((r) => JSON.stringify(r)));
    if (sigs.size === 1) identical++;
    else conflicting++;
  }
  P(
    `- duplicate \`${key}\` values: ${fmtInt(dupKeys.length)} &nbsp;·&nbsp; byte-identical: ${fmtInt(
      identical,
    )} &nbsp;·&nbsp; **conflicting: ${fmtInt(conflicting)}**`,
  );
  return { identical, conflicting };
}

// ---------------------------------------------------------------------------
// 4. Run
// ---------------------------------------------------------------------------

function main(): void {
  verifySeedIntegrity();

  const kc = loadTable("kilele-contacts.csv", ",");
  const kd = loadTable("kilele-contacts-delta-2026-09-01.csv", ",");
  const kk = loadTable("kilele-campaigns.csv", ",");
  const ke = loadTable("kilele-events.csv", ",");
  const ks = loadTable("kilele-send-log.csv", ",");
  const rc = loadTable("karoo-contacts.csv", ",");
  const rk = loadTable("karoo-campaigns.csv", ",");
  const re = loadTable("karoo-events.csv", ",");
  const mc = loadTable("marrakech-contacts.csv", ";");
  const mk = loadTable("marrakech-campaigns.csv", ";");
  const me = loadTable("marrakech-events.csv", ";");

  P("# Data findings — generated report");
  P();
  P(
    "> Regenerated by `npm run profile` (`scripts/profile-seed.ts`). Do not hand-edit — edit the " +
      "script and re-run. This is the evidence behind §2 of `docs/IMPLEMENTATION_PLAN.md`; the " +
      "numbers here are live, not copied.",
  );
  P();
  P(`Generated: ${new Date().toISOString()}`);
  P();

  // --- File-level summary table -------------------------------------------------
  P("## File summary");
  P();
  P("| File | Rows | Cols | Delimiter | Encoding | BOM | Ragged rows | Blank lines |");
  P("|---|---:|---:|:---:|---|:---:|---:|---:|");
  for (const t of [kc, kd, kk, ke, ks, rc, rk, re, mc, mk, me]) {
    P(
      `| \`${t.file}\` | ${fmtInt(t.rows.length)} | ${t.header.length} | \`${
        t.delimiter
      }\` | ${t.encoding} | ${t.hadBom ? "yes" : "no"} | ${fmtInt(t.raggedCount)} | ${fmtInt(
        t.blankLineCount,
      )} |`,
    );
  }
  P();

  // --- Kilele contacts ------------------------------------------------------
  P("## Kilele contacts");
  P();
  reportFile(kc);
  for (const [col, opts] of [
    ["external_id", {}],
    ["email", { isEmail: true }],
    ["phone", { isPhone: true }],
    ["country", { showValues: true }],
    ["city", { showValues: true }],
    ["signup_at", { isDate: true }],
    ["status", { showValues: true }],
    ["consent_marketing", { showValues: true }],
    ["brand_code", { showValues: true }],
  ] as const) {
    reportColumn(kc, col, opts);
  }
  reportDupKey(kc, "external_id");
  const kcKaroo = kc.rows.filter((r) => r.brand_code === "KAROO");
  P(`- rows carrying \`brand_code=KAROO\` inside the Kilele file (cross-brand contamination): **${fmtInt(kcKaroo.length)}**`);
  const kcFuture = kc.rows.filter((r) => {
    const d = parseSeedDate(r.signup_at);
    return d !== null && d.getTime() > Date.now();
  });
  P(`- \`signup_at\` in the future relative to when this report ran: ${fmtInt(kcFuture.length)}`);
  const kcSciPhones = kc.rows.filter((r) => /^\d\.\d+E\+\d+$/.test(r.phone ?? ""));
  P(`- phone values mangled into scientific notation (unrecoverable): ${fmtInt(kcSciPhones.length)}`);
  const kcLongNotes = kc.rows.filter((r) => (r.notes ?? "").length > 200);
  P(`- \`notes\` longer than 200 chars: ${fmtInt(kcLongNotes.length)}${
    kcLongNotes.length ? ` (max ${fmtInt(Math.max(...kcLongNotes.map((r) => r.notes.length)))} chars)` : ""
  }`);
  const kcNewlineNotes = kc.rows.filter((r) => (r.notes ?? "").includes("\n"));
  P(`- \`notes\` with an embedded newline (inside a quoted field): ${fmtInt(kcNewlineNotes.length)}`);
  const kcHeaderRows = kc.rows.filter((r) => r.external_id === "external_id");
  P(`- embedded header row(s) repeated as data: ${fmtInt(kcHeaderRows.length)}`);
  P();

  // --- Kilele delta ------------------------------------------------------
  P("## Kilele contacts delta (`kilele-contacts-delta-2026-09-01.csv`)");
  P();
  reportFile(kd);
  const kcIds = new Set(kc.rows.map((r) => r.external_id).filter((v) => v && v !== "external_id"));
  const kdIds = new Set(kd.rows.map((r) => r.external_id));
  const overlap = [...kdIds].filter((id) => kcIds.has(id));
  P(`- ids in main file: ${fmtInt(kcIds.size)} &nbsp;·&nbsp; ids in delta: ${fmtInt(kdIds.size)}`);
  P(`- overlap (existing ids the delta replaces): **${fmtInt(overlap.length)}**`);
  P(`- delta-only (brand-new ids): ${fmtInt(kdIds.size - overlap.length)}`);
  const correctedNote = kd.rows.filter((r) => r.notes === "corrected in Sept export").length;
  P(`- delta rows marked \`notes='corrected in Sept export'\`: ${fmtInt(correctedNote)}`);
  P();

  // --- Kilele campaigns / events / send-log ------------------------------
  P("## Kilele campaigns");
  P();
  reportFile(kk);
  reportDupKey(kk, "external_id");
  const kkInconsistentOpens = kk.rows.filter(
    (r) => Number(r.reported_opens) > Number(r.reported_delivered),
  );
  const kkInconsistentSum = kk.rows.filter(
    (r) => Number(r.reported_delivered) + Number(r.reported_bounced) !== Number(r.reported_sent),
  );
  P(`- campaigns where reported_opens > reported_delivered: **${fmtInt(kkInconsistentOpens.length)}** / ${kk.rows.length}`);
  P(`- campaigns where reported_delivered + reported_bounced ≠ reported_sent: **${fmtInt(kkInconsistentSum.length)}** / ${kk.rows.length}`);
  P();

  P("## Kilele engagement events");
  P();
  reportFile(ke);
  reportColumn(ke, "event_type", { showValues: true });
  reportDupKey(ke, "event_id");
  const keCampaignIds = new Set(kk.rows.map((r) => r.external_id));
  const keOrphanCampaign = new Set(
    ke.rows.filter((r) => !keCampaignIds.has(r.campaign_external_id)).map((r) => r.campaign_external_id),
  );
  P(`- event rows referencing an unknown campaign: ${fmtInt([...keOrphanCampaign].length)} distinct id(s)`);
  const idsSorted = ke.rows.every((r, i, arr) => i === 0 || arr[i - 1].event_id <= r.event_id);
  const tsSorted = ke.rows.every(
    (r, i, arr) => i === 0 || arr[i - 1].occurred_at_utc <= r.occurred_at_utc,
  );
  P(`- file already sorted by \`event_id\`: ${idsSorted} &nbsp;·&nbsp; by \`occurred_at_utc\`: ${tsSorted}`);
  const campaignsWithNoEvents = kk.rows
    .map((r) => r.external_id)
    .filter((id) => !ke.rows.some((r) => r.campaign_external_id === id));
  P(`- Kilele campaigns with zero events: ${campaignsWithNoEvents.length ? campaignsWithNoEvents.map((s) => `\`${s}\``).join(", ") : "none"}`);
  P();

  P("## Kilele send log");
  P();
  reportFile(ks);
  P();

  // --- Karoo ------------------------------------------------------
  P("## Karoo contacts");
  P();
  reportFile(rc);
  for (const [col, opts] of [
    ["External Id", {}],
    ["Email", { isEmail: true }],
    ["Phone", { isPhone: true }],
    ["Country", { showValues: true }],
    ["Status", { showValues: true }],
    ["Signup At", { isDate: true }],
  ] as const) {
    reportColumn(rc, col, opts);
  }
  reportDupKey(rc, "External Id");
  const rcKilele = rc.rows.filter((r) => r["Brand Code"] === "KILELE");
  P(`- rows carrying \`Brand Code=KILELE\` inside the Karoo file (cross-brand contamination): **${fmtInt(rcKilele.length)}**`);
  P();

  P("## Karoo campaigns");
  P();
  reportFile(rk);
  reportDupKey(rk, "external_id");
  P();

  P("## Karoo engagement events");
  P();
  reportFile(re);
  reportColumn(re, "event_type", { showValues: true });
  reportDupKey(re, "event_id");
  P();

  // --- Marrakech ------------------------------------------------------
  P("## Marrakech contacts (`;`-delimited, French headers)");
  P();
  reportFile(mc);
  for (const [col, opts] of [
    ["external_id", {}],
    ["e_mail", { isEmail: true }],
    ["mobile", { isPhone: true }],
    ["pays", { showValues: true }],
    ["signup_at", { isDate: true }],
    ["brand_code", { showValues: true }],
  ] as const) {
    reportColumn(mc, col, opts);
  }
  reportDupKey(mc, "external_id");
  const mcForeignEmail = mc.rows.filter((r) => r.e_mail && !r.e_mail.toLowerCase().includes(".mar"));
  P(`- rows whose \`e_mail\` does not match the \`.marNNN@\` pattern (looks like another brand's address): ${fmtInt(mcForeignEmail.length)}`);
  P();

  P("## Marrakech campaigns (`;`-delimited, decimal-comma spend)");
  P();
  reportFile(mk);
  P("| external_id | name | channel | sent | spend (raw) |");
  P("|---|---|---|---:|---|");
  for (const r of mk.rows) {
    P(`| ${r.external_id} | ${r.campaign_name} | ${r.channel} | ${r.reported_sent} | \`${r.spend}\` |`);
  }
  P();

  P("## Marrakech engagement events");
  P();
  reportFile(me);
  reportColumn(me, "event_type", { showValues: true });
  const mkCampaignIds = new Set(mk.rows.map((r) => r.external_id));
  const meOrphans = me.rows.filter((r) => !mkCampaignIds.has(r.campaign_external_id));
  const meOrphanCampaigns = [...new Set(meOrphans.map((r) => r.campaign_external_id))].sort();
  P(
    `- events referencing a campaign absent from \`marrakech-campaigns.csv\`: **${fmtInt(
      meOrphans.length,
    )}** / ${me.rows.length}, across ${meOrphanCampaigns.length} campaign id(s): ${meOrphanCampaigns
      .map((s) => `\`${s}\``)
      .join(", ")}`,
  );
  P();

  // --- Cross-brand contamination summary ------------------------------
  P("## Cross-brand contamination summary");
  P();
  P("| Where | What | Count |");
  P("|---|---|---:|");
  P(`| \`kilele-contacts.csv\` | rows with \`brand_code=KAROO\` | ${fmtInt(kcKaroo.length)} |`);
  P(`| \`karoo-contacts.csv\` | rows with \`Brand Code=KILELE\` | ${fmtInt(rcKilele.length)} |`);
  P(`| \`marrakech-contacts.csv\` | \`e_mail\` values that look like Kilele addresses | ${fmtInt(mcForeignEmail.length)} |`);
  P();

  // --- Timezone check (send_local_time - sent_at_utc) ------------------------------
  P("## Brand timezone check (`send_local_time` − `sent_at_utc`)");
  P();
  P(
    "`send_local_time` is truncated to the minute while `sent_at_utc` carries seconds, so the raw " +
      "difference jitters by up to a minute around each row's true offset (flooring, not rounding, " +
      "at generation time) — the modal value below is the brand's real offset.",
  );
  P();
  P("| Brand | Modal offset | Rows at mode | Spread (min) | All offsets seen |");
  P("|---|---|---:|---|---|");
  for (const [name, t] of [
    ["Kilele", kk],
    ["Karoo", rk],
    ["Marrakech", mk],
  ] as const) {
    const offsetMinutes = t.rows.map((r) => {
      const utc = new Date(r.sent_at_utc);
      const [d, hm] = r.send_local_time.split(" ");
      const local = new Date(`${d}T${hm}:00Z`);
      return Math.round((local.getTime() - utc.getTime()) / 60000);
    });
    const c = counter(offsetMinutes.map(String));
    const [modeStr, modeCount] = topN(c, 1)[0];
    const mode = Number(modeStr);
    const nearestHour = Math.round(mode / 60);
    const all = [...new Set(offsetMinutes)].sort((a, b) => a - b);
    P(
      `| ${name} | UTC${nearestHour >= 0 ? "+" : ""}${nearestHour} (mode ${mode}min) | ${fmtInt(
        modeCount,
      )} / ${fmtInt(t.rows.length)} | ${all[all.length - 1] - all[0]} | ${all
        .map((m) => `${m}min`)
        .join(", ")} |`,
    );
  }
  P();

  writeFileSync(OUT_PATH, out.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${OUT_PATH} (${out.length} lines).`);
}

main();
