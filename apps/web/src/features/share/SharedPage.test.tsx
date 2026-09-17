import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SharedPage } from "./SharedPage.js";
import { supabase } from "@/lib/supabase.js";

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/shared${search}`]}>
      <SharedPage />
    </MemoryRouter>,
  );
}

describe("SharedPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a message when the link has no token at all", () => {
    renderAt("");
    expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
  });

  it("AC-SHARE-03: a wrong password shows one generic message, never distinguishing the failure mode", async () => {
    vi.spyOn(supabase, "functions", "get").mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ data: null, error: new Error("unauthorized") }),
    } as never);

    renderAt("?token=abc123");
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /view results/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't valid/i));
  });

  it("shows the campaign results on a correct password, with no PII fields anywhere in the payload it renders", async () => {
    vi.spyOn(supabase, "functions", "get").mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        data: {
          campaignName: "Spring Sale",
          channel: "email",
          sentAt: "2026-02-09T00:08:45Z",
          reportedSent: 10640,
          reportedDelivered: 10108,
          reportedBounced: 489,
          reportedOpens: 12679,
          uniqueOpens: 500,
          openRate: 0.0495,
          bounceRate: 0.046,
        },
        error: null,
      }),
    } as never);

    renderAt("?token=abc123");
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: /view results/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Spring Sale" })).toBeInTheDocument());
    expect(screen.getByText("10108")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("5.0%")).toBeInTheDocument();
  });
});
