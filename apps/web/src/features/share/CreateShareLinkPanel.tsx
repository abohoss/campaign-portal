import { useState } from "react";
import { useCreateShareLink } from "./useCreateShareLink.js";

/** Owner-only by convention of where it's rendered — the real gate is server-side in
 *  create_share_link (authorize(brand,'owner')). Shows the token exactly once: it is never
 *  retrievable again after this render, only its SHA-256 is stored server-side. */
export function CreateShareLinkPanel({ campaignId, isOwner }: { campaignId: string; isOwner: boolean }): JSX.Element | null {
  const [password, setPassword] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateShareLink(campaignId);

  if (!isOwner) return null;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    try {
      const token = await create.mutateAsync(password);
      setCreatedLink(`${window.location.origin}/shared?token=${encodeURIComponent(token)}`);
      setPassword("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create a share link");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium">Share with a client</h3>
      {createdLink ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Copy this link now — it won't be shown again. Share the password separately.
          </p>
          <input
            readOnly
            value={createdLink}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-input bg-muted px-3 py-2 text-xs"
          />
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label htmlFor="share-password" className="block text-sm font-medium">
              Password (min. 8 characters)
            </label>
            <input
              id="share-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create share link"}
          </button>
        </form>
      )}
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
    </div>
  );
}
