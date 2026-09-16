import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { CampaignsPage } from "./CampaignsPage.js";
import * as useCampaignPerformanceModule from "./useCampaignPerformance.js";
import type { Membership } from "../auth/useMembership.js";
import type { CampaignPerformance } from "./useCampaignPerformance.js";

function renderWithProviders(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const membership: Membership = { role: "owner", brandId: "b1", brandSlug: "kilele", brandName: "Kilele Rides" };

const campaign: CampaignPerformance = {
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

describe("CampaignsPage", () => {
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

    renderWithProviders(<CampaignsPage membership={membership} />);
    expect(screen.getByText(/loading campaigns/i)).toBeInTheDocument();
  });

  it("shows an explicit error state", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("boom"),
    } as never);

    renderWithProviders(<CampaignsPage membership={membership} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
  });

  it("shows an explicit empty state", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [],
      error: null,
    } as never);

    renderWithProviders(<CampaignsPage membership={membership} />);
    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
  });

  it("renders a campaign linking to its detail page, with a data-quality note when figures don't reconcile", () => {
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      isLoading: false,
      isError: false,
      data: [campaign],
      error: null,
    } as never);

    renderWithProviders(<CampaignsPage membership={membership} />);
    const link = screen.getByRole("link", { name: /spring sale/i });
    expect(link).toHaveAttribute("href", "/campaigns/c1");
    expect(screen.getByText(/data-quality note/i)).toBeInTheDocument();
  });
});
