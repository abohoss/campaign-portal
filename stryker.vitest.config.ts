import { defineConfig } from "vitest/config";

// Dedicated config for StrykerJS only (stryker.conf.json → vitest.configFile). Lives at the repo
// root — same level as stryker.conf.json — with a repo-root-relative include glob, so there's no
// ambiguity about what "root" means once Stryker copies the project into its sandbox directory.
// The normal dev/test workflow uses vitest.workspace.ts + `--project` instead; this file exists
// only because the vitest-runner needs one concrete, unambiguous config.
export default defineConfig({
  test: {
    include: ["packages/domain/src/**/*.test.ts"],
    environment: "node",
  },
});
