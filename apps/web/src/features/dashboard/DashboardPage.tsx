import type { Membership } from "../auth/useMembership.js";
import { CountingNote } from "@/components/CountingNote.js";
import { useDashboardTotals } from "./useDashboardTotals.js";
import { useDashboardSignups } from "./useDashboardSignups.js";
import { useCampaignPerformance } from "../campaigns/useCampaignPerformance.js";
import { SignupsChart } from "./SignupsChart.js";

export function DashboardPage({ membership }: { membership: Membership }): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h2 className="text-lg font-semibold">{membership.brandName} dashboard</h2>
      <TotalsCards brandId={membership.brandId} />
      <SignupsSection brandId={membership.brandId} />
      <DataQualityBanner brandId={membership.brandId} />
    </div>
  );
}

function TotalsCards({ brandId }: { brandId: string }): JSX.Element | null {
  const { data, isLoading, isError, error } = useDashboardTotals(brandId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading totals…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load totals: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <p className="text-2xl font-semibold tabular-nums">{data.totalCustomers.toLocaleString()}</p>
        <p className="text-sm text-muted-foreground">Total customers</p>
        <CountingNote>Excludes deleted records. Includes unsubscribed and bounced contacts.</CountingNote>
      </div>
      <div className="rounded-lg border border-border p-4">
        <p className="text-2xl font-semibold tabular-nums">{data.contactable.toLocaleString()}</p>
        <p className="text-sm text-muted-foreground">Contactable</p>
        <CountingNote>
          Consented, not deleted, not unsubscribed or bounced, has a valid email, and not currently
          suppressed. Blank consent counts as not contactable.
        </CountingNote>
      </div>
    </div>
  );
}

function SignupsSection({ brandId }: { brandId: string }): JSX.Element | null {
  const { data, isLoading, isError, error } = useDashboardSignups(brandId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading signups…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load signups: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }
  if (!data) return null;

  const total = data.reduce((sum, d) => sum + d.signups, 0);

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Signups, last 30 days</h3>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No signups in this window. Reference date is today, not the last date in the data.
        </p>
      ) : (
        <SignupsChart points={data} />
      )}
      <CountingNote>
        Daily signups, bucketed in this brand's own timezone. Reference date is today, not the last
        date in the data.
      </CountingNote>
    </div>
  );
}

function DataQualityBanner({ brandId }: { brandId: string }): JSX.Element | null {
  const { data } = useCampaignPerformance(brandId);
  const inconsistent = (data ?? []).filter((c) => c.opensExceedDelivered || c.reportedTotalsInconsistent);
  if (inconsistent.length === 0) return null;

  return (
    <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {inconsistent.length} campaign{inconsistent.length === 1 ? "" : "s"} report figures that don't
      reconcile internally (e.g. more opens than deliveries). Provider-reported figures are shown as
      supplied and are not reconciled — see the campaigns list for details.
    </p>
  );
}
