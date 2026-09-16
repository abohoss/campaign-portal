import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useImportErrors } from "./useImportErrors.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = {
  row_number: 5,
  field: "email",
  value_excerpt: "bad@@vg-eval.test",
  reason_code: "INVALID_EMAIL",
  reason: "Email is malformed",
  severity: "warning" as const,
};

describe("useImportErrors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled (does not query) when importRunId is null", () => {
    const eq = vi.fn();
    vi.spyOn(supabase, "from").mockReturnValue({
      select: vi.fn().mockReturnValue({ eq }),
    } as never);

    renderHook(() => useImportErrors(null, 0, "all"), { wrapper });
    expect(eq).not.toHaveBeenCalled();
  });

  it("fetches page 0 unfiltered by severity when severity is 'all'", async () => {
    const range = vi.fn().mockResolvedValue({ data: [row], error: null, count: 1 });
    const order = vi.fn().mockReturnValue({ range });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    vi.spyOn(supabase, "from").mockReturnValue({ select } as never);

    const { result } = renderHook(() => useImportErrors("run-1", 0, "all"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ rows: [row], count: 1 });
    expect(range).toHaveBeenCalledWith(0, 49);
  });

  it("adds a severity filter and pages correctly for page > 0", async () => {
    const severityEq = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    const range = vi.fn().mockReturnValue({ eq: severityEq });
    const order = vi.fn().mockReturnValue({ range });
    const runEq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq: runEq });
    vi.spyOn(supabase, "from").mockReturnValue({ select } as never);

    const { result } = renderHook(() => useImportErrors("run-1", 2, "error"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(severityEq).toHaveBeenCalledWith("severity", "error");
    expect(range).toHaveBeenCalledWith(100, 149);
  });

  it("defaults a null data payload to an empty rows array", async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: null, count: 0 });
    const order = vi.fn().mockReturnValue({ range });
    const eq = vi.fn().mockReturnValue({ order });
    vi.spyOn(supabase, "from").mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) } as never);

    const { result } = renderHook(() => useImportErrors("run-1", 0, "all"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ rows: [], count: 0 });
  });

  it("surfaces a query error as isError rather than throwing", async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: new Error("boom"), count: null });
    const order = vi.fn().mockReturnValue({ range });
    const eq = vi.fn().mockReturnValue({ order });
    vi.spyOn(supabase, "from").mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) } as never);

    const { result } = renderHook(() => useImportErrors("run-1", 0, "all"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
