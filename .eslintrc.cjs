/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.stryker-tmp/**",
    "reports/**",
    "seed/**",
    "**/*.md",
  ],
  rules: {
    // §7.4: cyclomatic complexity gate. Enforced everywhere, not just packages/domain — a
    // 10-branch React component is exactly as untestable as a 10-branch validator.
    complexity: ["error", 10],
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
  overrides: [
    {
      // React app: browser globals + hooks/refresh rules. Kept out of the base config so
      // packages/domain (pure TS, no framework) never picks up a React-only rule by accident.
      files: ["apps/web/**/*.{ts,tsx}"],
      env: { browser: true, es2022: true },
      plugins: ["react-hooks", "react-refresh"],
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      },
    },
    {
      // scripts/** are one-off analysis/tooling scripts (data profiling, AC-coverage checking) —
      // not part of the tested, mutation-gated application logic the complexity rule exists to
      // protect (that's packages/domain and apps/web). console output is the point here too.
      files: ["scripts/**/*.ts", "*.config.{ts,cjs,js}", ".eslintrc.cjs"],
      rules: { "no-console": "off", complexity: "off" },
    },
    {
      files: ["**/*.test.{ts,tsx}"],
      rules: {
        // Test files legitimately have more branches (one per case) than production code should.
        complexity: "off",
      },
    },
  ],
};
