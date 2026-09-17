/**
 * scripts/run-mutation.ts
 *
 * Wraps `stryker run`. Vitest auto-discovers `vitest.workspace.ts` by filename convention from
 * the repo root regardless of the explicit `--config stryker.vitest.config.ts` StrykerJS passes
 * (confirmed empirically: `npx vitest run -c stryker.vitest.config.ts` still executed
 * tests/integration/** even though that config's own `include`/`exclude` explicitly rule it out).
 * That workspace defines the "integration" project, which hits the real live Supabase project —
 * exactly what a mutation dry run (which mutates and re-runs the suite hundreds of times) must
 * never do. Hiding the workspace file for the duration of the Stryker run is the reliable fix;
 * `stryker.vitest.config.ts`'s own include/exclude stays as the documented intent for anyone
 * reading it, this is the belt to that braces.
 */
import { renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WORKSPACE_FILE = "vitest.workspace.ts";
const HIDDEN_NAME = "vitest.workspace.ts.stryker-hidden";

function main(): void {
  const hadWorkspace = existsSync(WORKSPACE_FILE);
  if (hadWorkspace) renameSync(WORKSPACE_FILE, HIDDEN_NAME);

  let exitCode = 1;
  try {
    const result = spawnSync("npx", ["stryker", "run"], { stdio: "inherit", shell: true });
    exitCode = result.status ?? 1;
  } finally {
    if (hadWorkspace) renameSync(HIDDEN_NAME, WORKSPACE_FILE);
  }

  process.exit(exitCode);
}

main();
