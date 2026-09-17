import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDashboardSignupExtent } from "./useDashboardSignupExtent.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDashboardSignupExtent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the earliest/latest signup row", async () => {
    const rpc = vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: [{ earliest_signup: "2026-02-01", latest_signup: "2026-04-17" }],
      error: null,
    } as never);

    const { result } = renderHook(() => useDashboardSignupExtent("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ earliestSignup: "2026-02-01", latestSignup: "2026-04-17" });
    expect(rpc).toHaveBeenCalledWith("dashboard_signup_extent", { p_brand_id: "brand-1" });
  });

  it("defaults a null/empty payload to null dates rather than throwing", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: null } as never);

    const { result } = renderHook(() => useDashboardSignupExtent("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ earliestSignup: null, latestSignup: null });
  });

  it("surfaces an RPC error as isError", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: new Error("boom") } as never);

    const { result } = renderHook(() => useDashboardSignupExtent("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
