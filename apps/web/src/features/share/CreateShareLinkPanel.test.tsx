import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CreateShareLinkPanel } from "./CreateShareLinkPanel.js";
import * as useCreateShareLinkModule from "./useCreateShareLink.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("CreateShareLinkPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing for a non-owner", () => {
    const { container } = renderWithClient(<CreateShareLinkPanel campaignId="c1" isOwner={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submits the password and shows the returned link exactly once, never again after re-render", async () => {
    const mutateAsync = vi.fn().mockResolvedValue("plaintext-token-abc");
    vi.spyOn(useCreateShareLinkModule, "useCreateShareLink").mockReturnValue({
      mutateAsync,
      isPending: false,
    } as never);

    renderWithClient(<CreateShareLinkPanel campaignId="c1" isOwner={true} />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "a-real-password" } });
    fireEvent.click(screen.getByRole("button", { name: /create share link/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("a-real-password"));
    const linkInput = await screen.findByDisplayValue(/token=plaintext-token-abc/);
    expect(linkInput).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create share link/i })).not.toBeInTheDocument();
  });

  it("shows a form-level error when creation fails", async () => {
    vi.spyOn(useCreateShareLinkModule, "useCreateShareLink").mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("only an owner can create a share link")),
      isPending: false,
    } as never);

    renderWithClient(<CreateShareLinkPanel campaignId="c1" isOwner={true} />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "a-real-password" } });
    fireEvent.click(screen.getByRole("button", { name: /create share link/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/only an owner/i));
  });
});
