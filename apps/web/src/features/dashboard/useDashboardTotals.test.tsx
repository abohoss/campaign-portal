import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDashboardTotals } from "./useDashboardTotals.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDashboardTotals", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the RPC's snake_case row to { totalCustomers, contactable }", async () => {
    const single = vi.fn().mockResolvedValue({ data: { total_customers: 918, contactable: 400 }, error: null });
    vi.spyOn(supabase, "rpc").mockReturnValue({ single } as never);

    const { result } = renderHook(() => useDashboardTotals("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ totalCustomers: 918, contactable: 400 });
    expect(supabase.rpc).toHaveBeenCalledWith("dashboard_totals", { p_brand_id: "brand-1" });
  });

  it("surfaces an RPC error as isError rather than throwing during render", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: new Error("not authorized") });
    vi.spyOn(supabase, "rpc").mockReturnValue({ single } as never);

    const { result } = renderHook(() => useDashboardTotals("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
