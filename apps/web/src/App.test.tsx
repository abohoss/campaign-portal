import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { App } from "./App.js";
import { useSession } from "./features/auth/useSession.js";
import { useMembership } from "./features/auth/useMembership.js";
import { supabase } from "./lib/supabase.js";

vi.mock("./features/auth/useSession.js");
vi.mock("./features/auth/useMembership.js");

// main.tsx provides the real QueryClientProvider in production; App itself doesn't, so a test
// rendering App directly (rather than through main.tsx's entry point) needs its own — the
// authenticated shell now renders ImportPage, which has real useQuery-backed children.
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  afterEach(() => window.history.pushState({}, "", "/"));

  it("renders the sign-in page when signed out", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(useMembership).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isSuccess: false,
      error: null,
    } as ReturnType<typeof useMembership>);

    renderApp();
    expect(screen.getByRole("heading", { name: "Campaign Portal" })).toBeInTheDocument();
  });

  it("renders the authenticated shell with the signed-in user's brand and role", async () => {
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
    // ImportPage's children (ImportRunsList) query import_runs for real — stub it so the test
    // doesn't hit the network or hang on a request to the dummy .env.test URL.
    vi.spyOn(supabase, "from").mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as never);
    // "/" now routes to the dashboard, not Import — navigate there directly so this test still
    // exercises the Import route's owner-only gate without also having to stub the dashboard RPCs.
    window.history.pushState({}, "", "/import");

    renderApp();
    expect(screen.getByRole("heading", { name: "Karoo Coaches" })).toBeInTheDocument();
    expect(await screen.findByText(/signed in as analyst/i)).toBeInTheDocument();
    // An analyst sees the "owner only" notice, not the upload form (AC-AUTH-07 applied to import).
    expect(screen.getByText(/only an owner can import data/i)).toBeInTheDocument();
  });
});
