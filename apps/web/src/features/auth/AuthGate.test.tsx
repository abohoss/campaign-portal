import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { AuthGate } from "./AuthGate.js";
import { useSession } from "./useSession.js";
import { useMembership } from "./useMembership.js";

vi.mock("./useSession.js");
vi.mock("./useMembership.js");

const mockUseSession = vi.mocked(useSession);
const mockUseMembership = vi.mocked(useMembership);

const fakeSession = { user: { id: "u1" } } as unknown as Session;

function queryResult(overrides: Partial<ReturnType<typeof useMembership>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    error: null,
    ...overrides,
  } as ReturnType<typeof useMembership>;
}

describe("AuthGate", () => {
  it("shows a loading state while the session is resolving (AC-UX-04)", () => {
    mockUseSession.mockReturnValue({ session: null, loading: true });
    mockUseMembership.mockReturnValue(queryResult({}));

    render(<AuthGate>{() => <div>protected content</div>}</AuthGate>);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("shows the sign-in page when there is no session", () => {
    mockUseSession.mockReturnValue({ session: null, loading: false });
    mockUseMembership.mockReturnValue(queryResult({}));

    render(<AuthGate>{() => <div>protected content</div>}</AuthGate>);
    expect(screen.getByRole("heading", { name: "Campaign Portal" })).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("shows a loading state while membership is resolving", () => {
    mockUseSession.mockReturnValue({ session: fakeSession, loading: false });
    mockUseMembership.mockReturnValue(queryResult({ isLoading: true }));

    render(<AuthGate>{() => <div>protected content</div>}</AuthGate>);
    expect(screen.getByText("Loading your workspace…")).toBeInTheDocument();
  });

  it("shows an explicit error state on a failed membership query, not a crash (AC-UX-06)", () => {
    mockUseSession.mockReturnValue({ session: fakeSession, loading: false });
    mockUseMembership.mockReturnValue(
      queryResult({ isError: true, error: new Error("boom") }),
    );

    render(<AuthGate>{() => <div>protected content</div>}</AuthGate>);
    expect(screen.getByText(/couldn't load your account/i)).toBeInTheDocument();
  });

  it("shows NoAccessScreen when signed in with zero memberships (AC-AUTH-06)", () => {
    mockUseSession.mockReturnValue({ session: fakeSession, loading: false });
    mockUseMembership.mockReturnValue(queryResult({ isSuccess: true, data: [] }));

    render(<AuthGate>{() => <div>protected content</div>}</AuthGate>);
    expect(screen.getByRole("heading", { name: "No access" })).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders the children with the membership when everything resolves", () => {
    mockUseSession.mockReturnValue({ session: fakeSession, loading: false });
    mockUseMembership.mockReturnValue(
      queryResult({
        isSuccess: true,
        data: [{ role: "owner", brandId: "b1", brandSlug: "kilele", brandName: "Kilele Rides" }],
      }),
    );

    render(<AuthGate>{(m) => <div>{m.brandName} / {m.role}</div>}</AuthGate>);
    expect(screen.getByText("Kilele Rides / owner")).toBeInTheDocument();
  });
});
