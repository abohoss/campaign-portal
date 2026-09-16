/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make both the RLS/state-machine reasoning and the mutation gate unreliable.",
      from: {},
      to: { circular: true },
    },
    {
      name: "web-must-not-import-server",
      severity: "error",
      comment:
        "The frontend ships with the anon key only. It must never pull in Edge Function code, " +
        "which runs with the service-role key and provider secret — that boundary is B3 in " +
        "docs/IMPLEMENTATION_PLAN.md §4.3.",
      from: { path: "^apps/web" },
      to: { path: "^supabase/functions" },
    },
    {
      name: "domain-must-not-import-framework",
      severity: "error",
      comment:
        "packages/domain is pure TypeScript (import validation, metric definitions, event " +
        "precedence) so it can be unit- and mutation-tested without a browser, a database, or a " +
        "running Supabase instance. A framework import here is an architecture violation, not a " +
        "style nit.",
      from: { path: "^packages/domain" },
      to: {
        path: [
          "^react($|/)",
          "^react-dom($|/)",
          "^@supabase/",
          "^@tanstack/",
          "^vite($|/)",
          "^@vitejs/",
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
