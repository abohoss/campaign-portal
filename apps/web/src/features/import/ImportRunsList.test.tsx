import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ImportRunsList } from "./ImportRunsList.js";
import * as useImportRunsModule from "./useImportRuns.js";
import type { ImportRun } from "./useImportRuns.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const baseRun: ImportRun = {
  id: "run-1",
  kind: "contacts",
  filename: "kilele-contacts.csv",
  status: "succeeded",
  total_rows: 100,
  processed_rows: 100,
  inserted_count: 90,
  updated_count: 10,
  rejected_count: 5,
  warning_count: 2,
  detected_encoding: "utf-8",
  detected_delimiter: ",",
  error_summary: null,
  created_at: "2026-09-01T00:00:00Z",
  finished_at: "2026-09-01T00:01:00Z",
};

describe("ImportRunsList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state, not a bare spinner", () => {
    vi.spyOn(useImportRunsModule, "useImportRuns").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);

    renderWithClient(<ImportRunsList onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByText(/loading import history/i)).toBeInTheDocument();
  });

  it("shows an explicit error state with the error message", () => {
    vi.spyOn(useImportRunsModule, "useImportRuns").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("network down"),
    } as never);

    renderWithClient(<ImportRunsList onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/network down/i);
  });

  it("shows an explicit empty state when there are no imports yet", () => {
    vi.spyOn(useImportRunsModule, "useImportRuns").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [],
      error: null,
    } as never);

    renderWithClient(<ImportRunsList onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByText(/no imports yet/i)).toBeInTheDocument();
  });

  it("renders a run, calls onSelect when clicked, and highlights the selected run", () => {
    vi.spyOn(useImportRunsModule, "useImportRuns").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [baseRun],
      error: null,
    } as never);
    const onSelect = vi.fn();

    renderWithClient(<ImportRunsList onSelect={onSelect} selectedId="run-1" />);
    const button = screen.getByRole("button", { name: /kilele-contacts\.csv/i });
    expect(button.className).toMatch(/bg-accent/);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("run-1");
  });

  it("renders a running import at 0% when total_rows is null, and shows the error_summary banner", () => {
    vi.spyOn(useImportRunsModule, "useImportRuns").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        {
          ...baseRun,
          status: "failed",
          total_rows: null,
          processed_rows: 0,
          error_summary: "Storage download failed",
        },
      ],
      error: null,
    } as never);

    renderWithClient(<ImportRunsList onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/storage download failed/i);
  });
});
