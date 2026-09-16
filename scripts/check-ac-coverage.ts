/**
 * scripts/check-ac-coverage.ts
 *
 * Fails if any acceptance criterion ID in docs/ACCEPTANCE.md is not referenced by at least one
 * test. This is the mechanical half of "every acceptance criterion maps to at least one automated
 * test" (docs/IMPLEMENTATION_PLAN.md §8) — it doesn't judge whether the test is any good, only
 * that nobody quietly shipped a feature with a criterion nobody wrote a test for.
 *
 * NOT wired into `npm run gate` as a blocking step until Phase 11 (final submission phase).
 * Each phase before that only builds and tests a handful of AC families — Phase 3 covers
 * AC-ISO-01..07, Phase 4 adds AC-AUTH-*, and so on — so at any point before Phase 11, most of the
 * 81 criteria are still legitimately untested because most of the app doesn't exist yet. Failing
 * the gate on that would be noise, not signal. Run it standalone at the end of every phase to see
 * real progress (`N/81 covered`), and make it a blocking `gate` step only once the feature set is
 * complete:
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
  for (const m of markdown.matchAll(AC_ID_RE)) {
    const id = m[1];
    if (id) ids.push(id);
  }
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
