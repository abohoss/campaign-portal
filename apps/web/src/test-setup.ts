// Extends Vitest's `expect` with DOM matchers (toBeInTheDocument, etc.) for apps/web's component
// tests. Harmless no-op for packages/domain's plain node-environment tests, which never touch it.
import "@testing-library/jest-dom/vitest";

// @testing-library/react's auto-cleanup only self-registers when it detects Vitest/Jest globals
// (`test.globals: true`), which this project deliberately doesn't enable — tests import
// `describe`/`it`/`expect` explicitly instead. Without this, render() output from one test
// accumulates in the jsdom document for every test after it in the same file.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => cleanup());
