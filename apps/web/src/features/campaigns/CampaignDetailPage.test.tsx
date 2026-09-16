import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { CampaignDetailPage } from "./CampaignDetailPage.js";
import * as useCampaignPerformanceModule from "./useCampaignPerformance.js";
import type { Membership } from "../auth/useMembership.js";
import type { CampaignPerformance } from "./useCampaignPerformance.js";

function renderAt(path: string, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const membership: Membership = { role: "owner", brandId: "b1", brandSlug: "kilele", brandName: "Kilele Rides" };

const campaignWithEvents: CampaignPerformance = {
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
};

// AC-UX-02: a real campaign with zero events (CMP-014, KIL-0033..035) — every count must render as
// a legitimate 0, never omitted or crashing.
const campaignWithNoEvents: CampaignPerformance = {
  ...campaignWithEvents,
  campaignId: "c2",
  name: "No Events Campaign",
  uniqueOpens: 0,
  totalOpens: 0,
  uniqueUnsubscribes: 0,
  openRate: null,
  bounceRate: null,
  spend: null,
  opensExceedDelivered: false,
  reportedTotalsInconsistent: false,
};

describe("CampaignDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);

    renderAt("/campaigns/c1", <CampaignDetailPage membership={membership} />);
    expect(screen.getByText(/loading campaign/i)).toBeInTheDocument();
  });

  it("shows an explicit error state", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("boom"),
    } as never);

    renderAt("/campaigns/c1", <CampaignDetailPage membership={membership} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
  });

  it("shows a not-found message when the id doesn't match any campaign", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [campaignWithEvents],
      error: null,
    } as never);

    renderAt("/campaigns/does-not-exist", <CampaignDetailPage membership={membership} />);
    expect(screen.getByText(/campaign not found/i)).toBeInTheDocument();
  });

  it("renders every metric, including reported/computed side-by-side and a data-quality note", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [campaignWithEvents],
      error: null,
    } as never);

    renderAt("/campaigns/c1", <CampaignDetailPage membership={membership} />);
    expect(screen.getByRole("heading", { name: "Spring Sale" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/don't reconcile internally/i);
    expect(screen.getByText("10108")).toBeInTheDocument(); // reported delivered
    expect(screen.getByText("500")).toBeInTheDocument(); // unique opens
    expect(screen.getByText("5.0%")).toBeInTheDocument(); // open rate formatted
    expect(screen.getByText("$650.07")).toBeInTheDocument();
  });

  it("AC-UX-02: a campaign with zero events renders legitimate zeros and dashes, not a crash", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [campaignWithNoEvents],
      error: null,
    } as never);

    renderAt("/campaigns/c2", <CampaignDetailPage membership={membership} />);
    expect(screen.getByRole("heading", { name: "No Events Campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
