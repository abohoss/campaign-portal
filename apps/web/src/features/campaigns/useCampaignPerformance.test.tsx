import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCampaignPerformance } from "./useCampaignPerformance.js";
import { supabase } from "@/lib/supabase.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const rawRow = {
  campaign_id: "c1",
  external_id: "KIL-0016",
  name: "Spring Sale",
  channel: "email",
  sent_at: "2026-02-09T00:08:45Z",
  reported_sent: 10640,
  reported_delivered: 10108,
  reported_bounced: 489,
  reported_opens: 12679,
  reported_clicks: 900,
  spend: "650.07",
  unique_opens: 500,
  total_opens: 700,
  unique_unsubscribes: 12,
  open_rate: "0.0495",
  bounce_rate: "0.046",
  opens_exceed_delivered: true,
  reported_totals_inconsistent: false,
};

describe("useCampaignPerformance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps snake_case RPC rows into CampaignPerformance, coercing numeric strings", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: [rawRow], error: null } as never);

    const { result } = renderHook(() => useCampaignPerformance("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        campaignId: "c1",
        externalId: "KIL-0016",
        name: "Spring Sale",
        channel: "email",
        sentAt: "2026-02-09T00:08:45Z",
        reportedSent: 10640,
        reportedDelivered: 10108,
        reportedBounced: 489,
        reportedOpens: 12679,
        reportedClicks: 900,
        spend: 650.07,
        uniqueOpens: 500,
        totalOpens: 700,
        uniqueUnsubscribes: 12,
        openRate: 0.0495,
        bounceRate: 0.046,
        opensExceedDelivered: true,
        reportedTotalsInconsistent: false,
      },
    ]);
  });

  it("passes through null spend/rates rather than coercing to 0 or NaN", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: [{ ...rawRow, spend: null, open_rate: null, bounce_rate: null }],
      error: null,
    } as never);

    const { result } = renderHook(() => useCampaignPerformance("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ spend: null, openRate: null, bounceRate: null });
  });

  it("surfaces an RPC error as isError", async () => {
    vi.spyOn(supabase, "rpc").mockResolvedValue({ data: null, error: new Error("boom") } as never);

    const { result } = renderHook(() => useCampaignPerformance("brand-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
