import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DashboardPage } from "./DashboardPage.js";
import * as useDashboardTotalsModule from "./useDashboardTotals.js";
import * as useDashboardSignupsModule from "./useDashboardSignups.js";
import * as useDashboardSignupExtentModule from "./useDashboardSignupExtent.js";
import * as useCampaignPerformanceModule from "../campaigns/useCampaignPerformance.js";
import type { Membership } from "../auth/useMembership.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const membership: Membership = { role: "owner", brandId: "b1", brandSlug: "kilele", brandName: "Kilele Rides" };

function daySeries(makeSignups: (i: number) => number) {
  return Array.from({ length: 30 }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, "0")}`, signups: makeSignups(i) }));
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupExtentModule, "useDashboardSignupExtent").mockReturnValue({
      data: { earliestSignup: null, latestSignup: null },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
  });

  it("shows explicit loading states for totals and signups", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByText(/loading totals/i)).toBeInTheDocument();
    expect(screen.getByText(/loading signups/i)).toBeInTheDocument();
  });

  it("shows explicit error states", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("totals down"),
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("signups down"),
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByText(/totals down/i)).toBeInTheDocument();
    expect(screen.getByText(/signups down/i)).toBeInTheDocument();
  });

  it("renders totals cards with their counting notes", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { totalCustomers: 918, contactable: 400 },
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: false,
      data: daySeries(() => 0),
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByText("918")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText(/blank consent counts as not contactable/i)).toBeInTheDocument();
  });

  it("shows the explicit zero-signups empty state when every day is 0 (real Karoo/Marrakech case)", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { totalCustomers: 100, contactable: 50 },
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: false,
      data: daySeries(() => 0),
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByText(/no signups in the last 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/no signups on file yet/i)).toBeInTheDocument();
  });

  it("names the brand's most recent signup date when the window is empty but data exists earlier", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { totalCustomers: 100, contactable: 50 },
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: false,
      data: daySeries(() => 0),
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupExtentModule, "useDashboardSignupExtent").mockReturnValue({
      data: { earliestSignup: "2026-02-01", latestSignup: "2026-04-17" },
      isLoading: false,
      isError: false,
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByText(/4\/17\/2026|17\/04\/2026/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view all time/i })).toBeInTheDocument();
  });

  it("switches the signups window when a period button is clicked", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { totalCustomers: 100, contactable: 50 },
      error: null,
    } as never);
    const signups = vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: false,
      data: daySeries(() => 0),
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    fireEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(signups).toHaveBeenLastCalledWith("b1", 90);
  });

  it("renders the signups chart when at least one day is non-zero", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { totalCustomers: 100, contactable: 50 },
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: false,
      data: daySeries((i) => (i === 5 ? 12 : 0)),
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows the data-quality banner when a campaign's figures don't reconcile", () => {
    vi.spyOn(useDashboardTotalsModule, "useDashboardTotals").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { totalCustomers: 100, contactable: 50 },
      error: null,
    } as never);
    vi.spyOn(useDashboardSignupsModule, "useDashboardSignups").mockReturnValue({
      isLoading: false,
      isError: false,
      data: daySeries(() => 0),
      error: null,
    } as never);
    vi.spyOn(useCampaignPerformanceModule, "useCampaignPerformance").mockReturnValue({
      data: [{ opensExceedDelivered: true, reportedTotalsInconsistent: false }],
      isLoading: false,
      isError: false,
      error: null,
    } as never);

    renderWithClient(<DashboardPage membership={membership} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/don't reconcile internally/i);
  });
});
