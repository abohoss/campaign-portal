import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { useMembership } from "./useMembership.js";
import { supabase } from "@/lib/supabase.js";

const fakeSession = { user: { id: "u1" } } as unknown as Session;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMembership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled (does not query) when there is no session", () => {
    const selectSpy = vi.fn();
    vi.spyOn(supabase, "from").mockReturnValue({ select: selectSpy } as never);

    renderHook(() => useMembership(null), { wrapper });
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("maps rows into { role, brandId, brandSlug, brandName }", async () => {
    vi.spyOn(supabase, "from").mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ role: "owner", brand_id: "b1", brands: { slug: "kilele", name: "Kilele Rides" } }],
        error: null,
      }),
    } as never);

    const { result } = renderHook(() => useMembership(fakeSession), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { role: "owner", brandId: "b1", brandSlug: "kilele", brandName: "Kilele Rides" },
    ]);
  });

  it("resolves to an empty array — not an error — when a user has no membership", async () => {
    vi.spyOn(supabase, "from").mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as never);

    const { result } = renderHook(() => useMembership(fakeSession), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces a query error as isError rather than throwing during render", async () => {
    vi.spyOn(supabase, "from").mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: new Error("network down") }),
    } as never);

    const { result } = renderHook(() => useMembership(fakeSession), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
