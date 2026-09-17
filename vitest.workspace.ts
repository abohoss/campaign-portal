import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";

// Two named projects, run independently via `--project <name>` (see package.json scripts):
//  - "unit": packages/domain and apps/web component-level tests. No external services.
//  - "integration": tests/integration/**, which need a real `supabase start` (Phase 3+). Empty
//    for now — passWithNoTests keeps `npm run gate` green until Phase 3 adds real tests, rather
//    than faking a pass by skipping the check entirely.
export default defineWorkspace([
  {
    // Vite/Vitest resolve .env* files relative to `envDir`, which otherwise defaults to the repo
    // root (where `vitest.workspace.ts` lives) — apps/web/.env.test would silently never load
    // without this, and apps/web/src/lib/supabase.ts would throw on the missing env vars the
    // moment any component test imports it.
    envDir: "apps/web",
    resolve: {
      // Mirrors apps/web/vite.config.ts's alias — that config isn't used for this root-level
      // test run, so "@/..." imports need their own resolution here too.
      alias: {
        "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      },
    },
    test: {
      name: "unit",
      environment: "node",
      // packages/domain has zero DOM dependency by design (dependency-cruiser enforces it) and
      // stays on the faster "node" environment; every apps/web test needs jsdom — including a
      // .test.ts file with no JSX literal of its own, since @testing-library/react's render()
      // still needs a real `document` regardless of whether the test file contains JSX syntax.
      environmentMatchGlobs: [["apps/**/src/**/*.test.{ts,tsx}", "jsdom"]],
      include: ["packages/**/*.test.ts", "apps/**/src/**/*.test.{ts,tsx}"],
      exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
      setupFiles: ["apps/web/src/test-setup.ts"],
    },
  },
  {
    test: {
      name: "integration",
      environment: "node",
      include: ["tests/integration/**/*.test.ts"],
      exclude: ["**/node_modules/**"],
      passWithNoTests: true,
      // These files share one live project (a handful of Postgres connections, one small
      // project's statement_timeout budget) — running them in parallel across files caused real
      // contention (timeouts, and two files racing to claim the same "free" campaign for a
      // scoped-write test). One file at a time trades wall-clock time for reliability, which is
      // the right trade for a suite that hits a real external resource, not an in-memory one.
      fileParallelism: false,
    },
  },
]);
