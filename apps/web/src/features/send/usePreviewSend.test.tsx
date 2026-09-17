import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePreviewSend } from "./usePreviewSend.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePreviewSend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls preview_send and maps the row to { sendId, recipientCount }", async () => {
    const single = vi.fn().mockResolvedValue({ data: { send_id: "send-1", recipient_count: 918 }, error: null });
    const rpc = vi.fn().mockReturnValue({ single });
    vi.spyOn(supabase, "rpc").mockImplementation(rpc);

    const { result } = renderHook(() => usePreviewSend("c1"), { wrapper });
    const value = await result.current.mutateAsync();

    expect(rpc).toHaveBeenCalledWith("preview_send", { p_campaign_id: "c1" });
    expect(value).toEqual({ sendId: "send-1", recipientCount: 918 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rejects when the RPC errors", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: new Error("only an owner can preview a send") });
    vi.spyOn(supabase, "rpc").mockReturnValue({ single } as never);

    const { result } = renderHook(() => usePreviewSend("c1"), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow(/only an owner/i);
  });
});
