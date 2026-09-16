import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { App } from "./App.js";
import { useSession } from "./features/auth/useSession.js";
import { useMembership } from "./features/auth/useMembership.js";

vi.mock("./features/auth/useSession.js");
vi.mock("./features/auth/useMembership.js");

describe("App", () => {
  it("renders the sign-in page when signed out", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(useMembership).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isSuccess: false,
      error: null,
    } as ReturnType<typeof useMembership>);

    render(<App />);
    expect(screen.getByRole("heading", { name: "Campaign Portal" })).toBeInTheDocument();
  });

  it("renders the authenticated shell with the signed-in user's brand and role", () => {
    vi.mocked(useSession).mockReturnValue({
      session: { user: { id: "u1" } } as unknown as Session,
      loading: false,
    });
    vi.mocked(useMembership).mockReturnValue({
      data: [{ role: "analyst", brandId: "b1", brandSlug: "karoo", brandName: "Karoo Coaches" }],
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
    } as ReturnType<typeof useMembership>);

    render(<App />);
    expect(screen.getByRole("heading", { name: "Karoo Coaches" })).toBeInTheDocument();
    expect(screen.getByText("analyst")).toBeInTheDocument();
  });
});
