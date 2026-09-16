import { defineWorkspace } from "vitest/config";

// Two named projects, run independently via `--project <name>` (see package.json scripts):
//  - "unit": packages/domain and apps/web component-level tests. No external services.
//  - "integration": tests/integration/**, which need a real `supabase start` (Phase 3+). Empty
//    for now — passWithNoTests keeps `npm run gate` green until Phase 3 adds real tests, rather
//    than faking a pass by skipping the check entirely.
export default defineWorkspace([
  {
    test: {
      name: "unit",
      environment: "node",
      // packages/domain has zero DOM dependency by design (dependency-cruiser enforces it) and
      // stays on the faster "node" environment; apps/web's React component tests need jsdom.
      environmentMatchGlobs: [["apps/**/src/**/*.test.tsx", "jsdom"]],
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
    },
  },
]);
