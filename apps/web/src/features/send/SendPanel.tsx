import { useState } from "react";
import { useSendForCampaign, type Send } from "./useSendForCampaign.js";
import { usePreviewSend } from "./usePreviewSend.js";
import { useConfirmSend } from "./useConfirmSend.js";

const STATUS_LABEL: Record<string, string> = {
  draft: "Ready to review",
  approved: "Approved — starting…",
  sending: "Sending…",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** AC-SEND-01..12: preview freezes the audience and shows its count; confirm re-validates that
 *  count server-side under a row lock before approving. Owner-only — an analyst sees status only,
 *  never these controls (the real gate is server-side in both RPCs; this is just UX). */
export function SendPanel({ campaignId, isOwner }: { campaignId: string; isOwner: boolean }): JSX.Element | null {
  const { data: send, isLoading, isError, error } = useSendForCampaign(campaignId);
  const preview = usePreviewSend(campaignId);
  const confirm = useConfirmSend(campaignId);
  const [formError, setFormError] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading send status…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load send status: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  async function handlePreview(): Promise<void> {
    setFormError(null);
    try {
      await preview.mutateAsync();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not preview this send");
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!send) return;
    setFormError(null);
    try {
      await confirm.mutateAsync({ sendId: send.id, expectedCount: send.snapshotCount });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not confirm this send");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-medium">Send</h3>

      {!send && (
        <NoSendYet isOwner={isOwner} isPending={preview.isPending} onPreview={() => void handlePreview()} />
      )}
      {send && send.status === "draft" && (
        <DraftSend send={send} isOwner={isOwner} isPending={confirm.isPending} onConfirm={() => void handleConfirm()} />
      )}
      {send && send.status !== "draft" && <SendProgress send={send} />}

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
    </div>
  );
}

function NoSendYet({
  isOwner,
  isPending,
  onPreview,
}: {
  isOwner: boolean;
  isPending: boolean;
  onPreview: () => void;
}): JSX.Element {
  if (!isOwner) return <p className="text-sm text-muted-foreground">No send has been started for this campaign.</p>;
  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={isPending}
      className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {isPending ? "Loading…" : "Preview send"}
    </button>
  );
}

function DraftSend({
  send,
  isOwner,
  isPending,
  onConfirm,
}: {
  send: Send;
  isOwner: boolean;
  isPending: boolean;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{send.snapshotCount.toLocaleString()}</span> contactable
        recipients will receive this campaign.
      </p>
      {isOwner ? (
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Confirming…" : `Confirm send to ${send.snapshotCount.toLocaleString()}`}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for an owner to confirm.</p>
      )}
    </div>
  );
}

function SendProgress({ send }: { send: Send }): JSX.Element {
  const inFlight = send.status === "approved" || send.status === "sending";
  return (
    <div className="space-y-1">
      <p className="text-sm">{STATUS_LABEL[send.status] ?? send.status}</p>
      {inFlight && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round((send.chunksDone / send.chunksTotal) * 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {send.chunksDone} / {send.chunksTotal} chunks · {send.snapshotCount.toLocaleString()} recipients
      </p>
    </div>
  );
}
