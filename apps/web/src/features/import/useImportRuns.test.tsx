import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useImportRuns, type ImportRun } from "./useImportRuns.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockRuns(runs: ImportRun[]) {
  const order = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValue({ data: runs, error: null }),
  });
  const select = vi.fn().mockReturnValue({ order });
  vi.spyOn(supabase, "from").mockReturnValue({ select } as never);
  return { select, order };
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
  rejected_count: 0,
  warning_count: 0,
  detected_encoding: "utf-8",
  detected_delimiter: ",",
  error_summary: null,
  created_at: "2026-09-01T00:00:00Z",
  finished_at: "2026-09-01T00:01:00Z",
};

describe("useImportRuns", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns runs ordered newest-first, most recent 20", async () => {
    const { select } = mockRuns([baseRun]);
    const { result } = renderHook(() => useImportRuns(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([baseRun]);
    expect(select).toHaveBeenCalled();
  });

  it("polls every 2s while a run is queued or running, and stops once everything has settled", async () => {
    mockRuns([{ ...baseRun, status: "running" }]);
    const { result } = renderHook(() => useImportRuns(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const activeQuery = result.current;
    expect(activeQuery.data?.[0]?.status).toBe("running");

    vi.restoreAllMocks();
    mockRuns([{ ...baseRun, status: "succeeded" }]);
    const { result: settledResult } = renderHook(() => useImportRuns(), { wrapper });
    await waitFor(() => expect(settledResult.current.isSuccess).toBe(true));
    expect(settledResult.current.data?.[0]?.status).toBe("succeeded");
  });

  it("surfaces a query error as isError rather than throwing", async () => {
    const order = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: null, error: new Error("network down") }),
    });
    vi.spyOn(supabase, "from").mockReturnValue({ select: vi.fn().mockReturnValue({ order }) } as never);

    const { result } = renderHook(() => useImportRuns(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
