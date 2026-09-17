import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SendPanel } from "./SendPanel.js";
import * as useSendForCampaignModule from "./useSendForCampaign.js";
import * as usePreviewSendModule from "./usePreviewSend.js";
import * as useConfirmSendModule from "./useConfirmSend.js";
import type { Send } from "./useSendForCampaign.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const draftSend: Send = {
  id: "send-1",
  status: "draft",
  snapshotCount: 918,
  chunksTotal: 1,
  chunksDone: 0,
  createdAt: "2026-09-16T00:00:00Z",
  approvedAt: null,
};

describe("SendPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state", () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
    } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={true} />);
    expect(screen.getByText(/loading send status/i)).toBeInTheDocument();
  });

  it("shows an explicit error state", () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("boom"),
    } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={true} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
  });

  it("owner with no send sees a Preview send button; clicking it calls preview_send", async () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: false,
      data: null,
      error: null,
    } as never);
    const mutateAsync = vi.fn().mockResolvedValue({ sendId: "send-1", recipientCount: 918 });
    vi.spyOn(usePreviewSendModule, "usePreviewSend").mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(useConfirmSendModule, "useConfirmSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={true} />);
    fireEvent.click(screen.getByRole("button", { name: /preview send/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });

  it("analyst with no send sees no Preview button, just a status message (AC-AUTH-07 applied to send)", () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: false,
      data: null,
      error: null,
    } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={false} />);
    expect(screen.queryByRole("button", { name: /preview send/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no send has been started/i)).toBeInTheDocument();
  });

  it("a draft shows the frozen count and, for an owner, a Confirm button that calls confirm_send with that count", async () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: false,
      data: draftSend,
      error: null,
    } as never);
    vi.spyOn(usePreviewSendModule, "usePreviewSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useConfirmSendModule, "useConfirmSend").mockReturnValue({ mutateAsync, isPending: false } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={true} />);
    expect(screen.getByText(/contactable recipients will receive/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm send/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ sendId: "send-1", expectedCount: 918 }));
  });

  it("an analyst sees the frozen count but no Confirm button on a draft", () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: false,
      data: draftSend,
      error: null,
    } as never);
    vi.spyOn(usePreviewSendModule, "usePreviewSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    vi.spyOn(useConfirmSendModule, "useConfirmSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={false} />);
    expect(screen.queryByRole("button", { name: /confirm send/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for an owner/i)).toBeInTheDocument();
  });

  it("shows a progress bar and chunk counts while sending", () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: false,
      data: { ...draftSend, status: "sending", chunksTotal: 4, chunksDone: 1 },
      error: null,
    } as never);
    vi.spyOn(usePreviewSendModule, "usePreviewSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    vi.spyOn(useConfirmSendModule, "useConfirmSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={true} />);
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 4 chunks/)).toBeInTheDocument();
  });

  it("shows a form-level error when confirm fails", async () => {
    vi.spyOn(useSendForCampaignModule, "useSendForCampaign").mockReturnValue({
      isLoading: false,
      isError: false,
      data: draftSend,
      error: null,
    } as never);
    vi.spyOn(usePreviewSendModule, "usePreviewSend").mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    const mutateAsync = vi.fn().mockRejectedValue(new Error("count_changed"));
    vi.spyOn(useConfirmSendModule, "useConfirmSend").mockReturnValue({ mutateAsync, isPending: false } as never);

    renderWithClient(<SendPanel campaignId="c1" isOwner={true} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm send/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/count_changed/i));
  });
});
