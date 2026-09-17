import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useConfirmSend } from "./useConfirmSend.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useConfirmSend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls confirm_send with the send id and expected count", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.spyOn(supabase, "rpc").mockImplementation(rpc);

    const { result } = renderHook(() => useConfirmSend("c1"), { wrapper });
    await result.current.mutateAsync({ sendId: "send-1", expectedCount: 918 });

    expect(rpc).toHaveBeenCalledWith("confirm_send", { p_send_id: "send-1", p_expected_count: 918 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rejects with the server's message when the count has changed since preview", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: new Error("count_changed") } as never);

    const { result } = renderHook(() => useConfirmSend("c1"), { wrapper });
    await expect(result.current.mutateAsync({ sendId: "send-1", expectedCount: 918 })).rejects.toThrow(
      "count_changed",
    );
  });
});
