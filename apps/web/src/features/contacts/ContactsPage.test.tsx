import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ContactsPage } from "./ContactsPage.js";
import * as useContactsModule from "./useContacts.js";
import type { Membership } from "../auth/useMembership.js";
import type { Contact } from "./useContacts.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const membership: Membership = { role: "owner", brandId: "b1", brandSlug: "kilele", brandName: "Kilele Rides" };

const contact: Contact = {
  id: "1",
  externalId: "CT-1",
  fullName: "Fatima Achieng",
  email: "a@vg-eval.test",
  phoneE164: "+254712345678",
  country: "KE",
  city: "Nairobi",
  status: "active",
  consentMarketing: true,
  signupAt: "2026-01-01T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
};

describe("ContactsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state", () => {
    vi.spyOn(useContactsModule, "useContacts").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);

    renderWithClient(<ContactsPage membership={membership} />);
    expect(screen.getByText(/loading contacts/i)).toBeInTheDocument();
  });

  it("shows an explicit error state", () => {
    vi.spyOn(useContactsModule, "useContacts").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("boom"),
    } as never);

    renderWithClient(<ContactsPage membership={membership} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
  });

  it("shows an explicit empty state when there are no contacts", () => {
    vi.spyOn(useContactsModule, "useContacts").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { pages: [[]] },
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as never);

    renderWithClient(<ContactsPage membership={membership} />);
    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument();
  });

  it("renders a page of contacts and loads more on click", () => {
    const fetchNextPage = vi.fn();
    vi.spyOn(useContactsModule, "useContacts").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { pages: [[contact]] },
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    } as never);

    renderWithClient(<ContactsPage membership={membership} />);
    expect(screen.getByText("Fatima Achieng")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("does not show a Load more button once there is no next page", () => {
    vi.spyOn(useContactsModule, "useContacts").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { pages: [[contact]] },
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as never);

    renderWithClient(<ContactsPage membership={membership} />);
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});
