// Extends Vitest's `expect` with DOM matchers (toBeInTheDocument, etc.) for apps/web's component
// tests. Harmless no-op for packages/domain's plain node-environment tests, which never touch it.
import "@testing-library/jest-dom/vitest";
