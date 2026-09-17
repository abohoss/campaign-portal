import { Link } from "react-router-dom";
import type { Membership } from "../auth/useMembership.js";
import { useCampaignPerformance } from "./useCampaignPerformance.js";

export function CampaignsPage({ membership }: { membership: Membership }): JSX.Element {
  const { data, isLoading, isError, error } = useCampaignPerformance(membership.brandId);

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading campaigns…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Couldn't load campaigns: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }
  if (!data || data.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No campaigns yet — import a file to get started.</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">Campaigns</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
        {data.map((c) => (
          <li key={c.campaignId}>
            <Link
              to={`/campaigns/${c.campaignId}`}
              className="flex min-h-11 items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-accent"
            >
              <span>
                <span className="font-medium">{c.name}</span>{" "}
                <span className="text-xs text-muted-foreground">{c.externalId}</span>
              </span>
              {(c.opensExceedDelivered || c.reportedTotalsInconsistent) && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Data-quality note
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
