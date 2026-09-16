import { defineConfig } from "vitest/config";

// Global options shared across every project in vitest.workspace.ts — coverage is configured
// here (not per-project) per Vitest's v8-provider convention. Thresholds are §7.4 of
// docs/IMPLEMENTATION_PLAN.md: 85%/80% overall, 95%/90% in packages/domain specifically, enforced
// via the v8 provider's per-glob threshold keys.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/**/src/**/*.{ts,tsx}", "apps/**/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "apps/web/src/main.tsx", // composition root — no branching logic to cover
        "apps/web/src/vite-env.d.ts",
      ],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
        "packages/domain/src/**": {
          lines: 95,
          branches: 90,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
