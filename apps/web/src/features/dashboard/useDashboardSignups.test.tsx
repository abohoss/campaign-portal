import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDashboardSignups } from "./useDashboardSignups.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDashboardSignups", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps rows and coerces signups to a number", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: [{ day: "2026-09-01", signups: "3" }],
      error: null,
    } as never);

    const { result } = renderHook(() => useDashboardSignups("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ day: "2026-09-01", signups: 3 }]);
  });

  it("defaults a null data payload to an empty array", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: null } as never);

    const { result } = renderHook(() => useDashboardSignups("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces an RPC error as isError", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: new Error("boom") } as never);

    const { result } = renderHook(() => useDashboardSignups("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
