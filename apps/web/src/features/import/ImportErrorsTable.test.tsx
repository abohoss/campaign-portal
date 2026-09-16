import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ImportErrorsTable } from "./ImportErrorsTable.js";
import * as useImportErrorsModule from "./useImportErrors.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const errorRow = {
  row_number: 5,
  field: "email",
  value_excerpt: "bad@@vg-eval.test",
  reason_code: "INVALID_EMAIL",
  reason: "Email is malformed",
  severity: "warning" as const,
};

describe("ImportErrorsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state", () => {
    vi.spyOn(useImportErrorsModule, "useImportErrors").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);

    renderWithClient(<ImportErrorsTable importRunId="run-1" />);
    expect(screen.getByText(/loading errors/i)).toBeInTheDocument();
  });

  it("shows an explicit error state", () => {
    vi.spyOn(useImportErrorsModule, "useImportErrors").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("boom"),
    } as never);

    renderWithClient(<ImportErrorsTable importRunId="run-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
  });

  it("shows an explicit empty state when there are zero errors", () => {
    vi.spyOn(useImportErrorsModule, "useImportErrors").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { rows: [], count: 0 },
      error: null,
    } as never);

    renderWithClient(<ImportErrorsTable importRunId="run-1" />);
    expect(screen.getByText(/no rejections or warnings/i)).toBeInTheDocument();
  });

  it("renders rows, excerpt with a fallback dash for a null value, and 'whole row' for a null field", () => {
    vi.spyOn(useImportErrorsModule, "useImportErrors").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { rows: [errorRow, { ...errorRow, row_number: 6, field: null, value_excerpt: null }], count: 2 },
      error: null,
    } as never);

    renderWithClient(<ImportErrorsTable importRunId="run-1" />);
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("(whole row)")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("changes severity filter and resets to page 0", () => {
    const spy = vi.spyOn(useImportErrorsModule, "useImportErrors").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { rows: [errorRow], count: 1 },
      error: null,
    } as never);

    renderWithClient(<ImportErrorsTable importRunId="run-1" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "error" } });
    expect(spy).toHaveBeenLastCalledWith("run-1", 0, "error");
  });

  it("paginates: Previous is disabled on page 0, Next advances the page", () => {
    const spy = vi.spyOn(useImportErrorsModule, "useImportErrors").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { rows: Array(50).fill(errorRow), count: 120 },
      error: null,
    } as never);

    renderWithClient(<ImportErrorsTable importRunId="run-1" />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(spy).toHaveBeenLastCalledWith("run-1", 1, "all");
  });
});
