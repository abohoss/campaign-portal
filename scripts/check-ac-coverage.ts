/**
 * scripts/check-ac-coverage.ts
 *
 * Fails if any acceptance criterion ID in docs/ACCEPTANCE.md is not referenced by at least one
 * test. This is the mechanical half of "every acceptance criterion maps to at least one automated
 * test" (docs/IMPLEMENTATION_PLAN.md §8) — it doesn't judge whether the test is any good, only
 * that nobody quietly shipped a feature with a criterion nobody wrote a test for.
 *
 * NOT wired into `npm run gate` until Phase 3 (see docs/IMPLEMENTATION_PLAN.md Phase 2's
 * executor prompt): in Phase 2 there are zero AC-mapped tests by design, since no feature exists
 * yet to test. Running this in the gate before that would fail on all 81 criteria for a reason
 * that has nothing to do with code quality. From Phase 3 onward, wire it in:
 *
 *   "gate": "... && npm run check:ac-coverage && ..."
 *
 * Usage: npm run check:ac-coverage
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const ACCEPTANCE_PATH = join(REPO_ROOT, "docs", "ACCEPTANCE.md");

const AC_ID_RE = /^###\s+(AC-[A-Z]+-\d+)\b/gm;
const TEST_GLOBS = [
  "packages/**/*.test.{ts,tsx}",
  "apps/**/src/**/*.test.{ts,tsx}",
  "tests/**/*.test.{ts,tsx}",
];

function extractAcIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const m of markdown.matchAll(AC_ID_RE)) ids.push(m[1]);
  return ids;
}

function findTestFiles(): string[] {
  const files: string[] = [];
  for (const pattern of TEST_GLOBS) {
    // Node's fs.globSync (Node 22+) — no extra dependency needed for a straightforward glob.
    try {
      files.push(...globSync(pattern, { cwd: REPO_ROOT }).map((f) => join(REPO_ROOT, f)));
    } catch {
      // Pattern matched nothing in an as-yet-nonexistent directory (e.g. tests/ before Phase 3).
    }
  }
  return files;
}

function main(): void {
  const acceptanceMd = readFileSync(ACCEPTANCE_PATH, "utf-8");
  const acIds = extractAcIds(acceptanceMd);
  if (acIds.length === 0) {
    throw new Error(`No AC IDs found in ${ACCEPTANCE_PATH} — check the heading format.`);
  }

  const testFiles = findTestFiles();
  const testContents = testFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

  const missing = acIds.filter((id) => !testContents.includes(id));

  console.log(`Checked ${acIds.length} acceptance criteria against ${testFiles.length} test file(s).`);
  if (missing.length === 0) {
    console.log("Every AC ID is referenced by at least one test. ✅");
    return;
  }

  console.error(`\n${missing.length} acceptance criterion/criteria have no test referencing their ID:\n`);
  for (const id of missing) console.error(`  - ${id}`);
  console.error(
    "\nAdd the AC ID to a test name (e.g. it(\"AC-AUTH-01: owner lands in own portal\", ...)) " +
      "or `describe` block, then re-run.",
  );
  process.exitCode = 1;
}

main();
