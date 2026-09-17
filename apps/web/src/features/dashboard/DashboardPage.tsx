import { useState } from "react";
import type { Membership } from "../auth/useMembership.js";
import { CountingNote } from "@/components/CountingNote.js";
import { useDashboardTotals } from "./useDashboardTotals.js";
import { useDashboardSignups } from "./useDashboardSignups.js";
import { useDashboardSignupExtent } from "./useDashboardSignupExtent.js";
import { useCampaignPerformance } from "../campaigns/useCampaignPerformance.js";
import { SignupsChart } from "./SignupsChart.js";

export function DashboardPage({ membership }: { membership: Membership }): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{membership.brandName} dashboard</h2>
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
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-2xl font-semibold tabular-nums">{data.totalCustomers.toLocaleString()}</p>
        <p className="text-sm text-muted-foreground">Total customers</p>
        <CountingNote>Excludes deleted records. Includes unsubscribed and bounced contacts.</CountingNote>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
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

const WINDOW_OPTIONS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function windowButtonClass(active: boolean): string {
  return `min-h-8 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
  }`;
}

/** "All time" isn't a fixed number — it's however many days back the earliest signup on file
 *  actually is, so the button always covers the real data instead of a guessed cutoff. Null when
 *  the brand has no signups on file at all (nothing to widen the window to). */
function computeAllTimeDays(earliestSignup: string | null | undefined): number | null {
  if (!earliestSignup) return null;
  return Math.max(30, Math.ceil((Date.now() - new Date(earliestSignup).getTime()) / MS_PER_DAY) + 1);
}

function WindowPicker({
  days,
  allTimeDays,
  onChange,
}: {
  days: number;
  allTimeDays: number | null;
  onChange: (days: number) => void;
}): JSX.Element {
  return (
    <div role="group" aria-label="Signups time window" className="flex flex-wrap gap-1">
      {WINDOW_OPTIONS.map((opt) => (
        <button
          key={opt.days}
          type="button"
          onClick={() => onChange(opt.days)}
          aria-pressed={days === opt.days}
          className={windowButtonClass(days === opt.days)}
        >
          {opt.label}
        </button>
      ))}
      {allTimeDays !== null && (
        <button
          type="button"
          onClick={() => onChange(allTimeDays)}
          aria-pressed={days === allTimeDays}
          className={windowButtonClass(days === allTimeDays)}
        >
          All time
        </button>
      )}
    </div>
  );
}

function EmptySignupsMessage({
  days,
  latestSignup,
  allTimeDays,
  onViewAllTime,
}: {
  days: number;
  latestSignup: string | null | undefined;
  allTimeDays: number | null;
  onViewAllTime: () => void;
}): JSX.Element {
  if (!latestSignup) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        No signups in the last {days.toLocaleString()} days. This brand has no signups on file yet.
      </p>
    );
  }

  const canWiden = allTimeDays !== null && days !== allTimeDays;
  return (
    <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      No signups in the last {days.toLocaleString()} days. This brand's most recent signup on file
      is <span className="font-medium text-foreground">{new Date(latestSignup).toLocaleDateString()}</span>
      {canWiden ? (
        <>
          {" "}
          —{" "}
          <button type="button" onClick={onViewAllTime} className="underline hover:no-underline">
            view all time
          </button>
          .
        </>
      ) : (
        "."
      )}
    </p>
  );
}

function SignupsSection({ brandId }: { brandId: string }): JSX.Element | null {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, error } = useDashboardSignups(brandId, days);
  const { data: extent } = useDashboardSignupExtent(brandId);

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
  const allTimeDays = computeAllTimeDays(extent?.earliestSignup);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Signups, last {days.toLocaleString()} days</h3>
        <WindowPicker days={days} allTimeDays={allTimeDays} onChange={setDays} />
      </div>
      {total === 0 ? (
        <EmptySignupsMessage
          days={days}
          latestSignup={extent?.latestSignup}
          allTimeDays={allTimeDays}
          onViewAllTime={() => allTimeDays !== null && setDays(allTimeDays)}
        />
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
