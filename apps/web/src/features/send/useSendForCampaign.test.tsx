import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSendForCampaign } from "./useSendForCampaign.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockRows(rows: Record<string, unknown>[]) {
  const order = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: rows, error: null }) });
  vi.spyOn(supabase, "from").mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) }) } as never);
}

const draftRow = {
  id: "send-1",
  status: "draft",
  snapshot_count: 918,
  chunks_total: 1,
  chunks_done: 0,
  created_at: "2026-09-16T00:00:00Z",
  approved_at: null,
};

describe("useSendForCampaign", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no send exists yet for this campaign", async () => {
    mockRows([]);
    const { result } = renderHook(() => useSendForCampaign("c1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("maps the most recent send row", async () => {
    mockRows([draftRow]);
    const { result } = renderHook(() => useSendForCampaign("c1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      id: "send-1",
      status: "draft",
      snapshotCount: 918,
      chunksTotal: 1,
      chunksDone: 0,
      createdAt: "2026-09-16T00:00:00Z",
      approvedAt: null,
    });
  });

  it("surfaces a query error as isError", async () => {
    const order = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: null, error: new Error("boom") }) });
    vi.spyOn(supabase, "from").mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) }) } as never);

    const { result } = renderHook(() => useSendForCampaign("c1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
