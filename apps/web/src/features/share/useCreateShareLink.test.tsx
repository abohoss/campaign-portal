import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateShareLink } from "./useCreateShareLink.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useCreateShareLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls create_share_link with the campaign id and password, returning the plaintext token", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "the-plaintext-token", error: null });
    vi.spyOn(supabase, "rpc").mockImplementation(rpc);

    const { result } = renderHook(() => useCreateShareLink("c1"), { wrapper });
    const token = await result.current.mutateAsync("a-real-password");

    expect(rpc).toHaveBeenCalledWith("create_share_link", { p_campaign_id: "c1", p_password: "a-real-password" });
    expect(token).toBe("the-plaintext-token");
  });

  it("rejects with the server's message when the password is too short", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: null,
      error: new Error("password must be at least 8 characters"),
    } as never);

    const { result } = renderHook(() => useCreateShareLink("c1"), { wrapper });
    await expect(result.current.mutateAsync("short")).rejects.toThrow(/at least 8/);
  });
});
