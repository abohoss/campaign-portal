import { Link, useParams } from "react-router-dom";
import type { Membership } from "../auth/useMembership.js";
import { CountingNote } from "@/components/CountingNote.js";
import { SendPanel } from "../send/SendPanel.js";
import { CreateShareLinkPanel } from "../share/CreateShareLinkPanel.js";
import { useCampaignPerformance, type CampaignPerformance } from "./useCampaignPerformance.js";

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function formatSpend(spend: number | null): string {
  return spend === null ? "—" : `$${spend.toFixed(2)}`;
}

/** Turns the two boolean data-quality flags into the actual numbers that tripped them, so the
 *  banner is self-explanatory instead of a bare "doesn't reconcile" with no way to see why —
 *  found from real user feedback: the generic banner pointed at nothing visible on screen, since
 *  reported_opens/reported_clicks (what the check actually compares) weren't rendered anywhere. */
function reconciliationNotes(c: CampaignPerformance): string[] {
  const notes: string[] = [];
  if (c.opensExceedDelivered) {
    notes.push(
      `Reported opens (${(c.reportedOpens ?? 0).toLocaleString()}) exceed reported delivered ` +
        `(${(c.reportedDelivered ?? 0).toLocaleString()}) in the brand's own export.`,
    );
  }
  if (c.reportedTotalsInconsistent) {
    const delivered = c.reportedDelivered ?? 0;
    const bounced = c.reportedBounced ?? 0;
    notes.push(
      `Reported delivered + bounced (${delivered.toLocaleString()} + ${bounced.toLocaleString()} = ` +
        `${(delivered + bounced).toLocaleString()}) doesn't equal reported sent (${(c.reportedSent ?? 0).toLocaleString()}).`,
    );
  }
  return notes;
}

/** A campaign with no events at all (e.g. real campaigns CMP-014, KIL-0033..035) must render as a
 *  legitimate zero here, not a spinner or a crash (AC-UX-02) — every count below defaults to 0/—
 *  rather than being conditionally omitted. */
export function CampaignDetailPage({ membership }: { membership: Membership }): JSX.Element {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { data, isLoading, isError, error } = useCampaignPerformance(membership.brandId);

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading campaign…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Couldn't load campaign: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }
  const campaign = data?.find((c) => c.campaignId === campaignId);
  if (!campaign) {
    return <p className="p-4 text-sm text-muted-foreground">Campaign not found.</p>;
  }

  const notes = reconciliationNotes(campaign);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <Link to="/campaigns" className="text-sm text-muted-foreground underline hover:no-underline">
        ← Campaigns
      </Link>
      <h2 className="text-xl font-semibold tracking-tight">{campaign.name}</h2>
      <p className="text-sm text-muted-foreground">
        {campaign.externalId} · {campaign.channel}
        {campaign.sentAt ? ` · sent ${new Date(campaign.sentAt).toLocaleDateString()}` : ""}
      </p>

      {notes.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">This campaign's reported figures don't reconcile internally:</p>
          <ul className="list-disc space-y-1 pl-5">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p>
            These are the brand's own export numbers, shown as supplied — never silently corrected.
            The "Unique opens"/"Total opens" figures below are computed independently from the
            engagement log and aren't affected by this.
          </p>
        </div>
      )}

      <CampaignMetricsGrid campaign={campaign} />
      <SendPanel campaignId={campaign.campaignId} isOwner={membership.role === "owner"} />
      <CreateShareLinkPanel campaignId={campaign.campaignId} isOwner={membership.role === "owner"} />
    </div>
  );
}

function CampaignMetricsGrid({ campaign }: { campaign: CampaignPerformance }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Metric label="Reported sent" value={campaign.reportedSent} />
      <div>
        <Metric label="Delivered" value={campaign.reportedDelivered} />
        <CountingNote>
          As reported in the brand's campaign export. The engagement log has no delivery events for
          historical campaigns, so this can't be recomputed.
        </CountingNote>
      </div>
      <Metric label="Reported bounced" value={campaign.reportedBounced} />
      <div>
        <Metric label="Reported opens" value={campaign.reportedOpens} />
        <CountingNote>
          As supplied in the brand's export — this is what "opens exceed delivered" (above, if
          shown) compares, not the computed figure below.
        </CountingNote>
      </div>
      <Metric label="Reported clicks" value={campaign.reportedClicks} />
      <div>
        <Metric label="Unique opens" value={campaign.uniqueOpens} />
        <CountingNote>Distinct people who opened at least once, from the engagement log.</CountingNote>
      </div>
      <div>
        <Metric label="Total opens" value={campaign.totalOpens} />
        <CountingNote>Every open event, including repeats by the same person.</CountingNote>
      </div>
      <div>
        <Metric label="Open rate" value={formatRate(campaign.openRate)} />
        <CountingNote>Unique opens ÷ delivered. Not ÷ sent.</CountingNote>
      </div>
      <div>
        <Metric label="Bounce rate" value={formatRate(campaign.bounceRate)} />
        <CountingNote>Bounced ÷ sent.</CountingNote>
      </div>
      <div>
        <Metric label="Unsubscribes" value={campaign.uniqueUnsubscribes} />
        <CountingNote>Distinct people, not events.</CountingNote>
      </div>
      <Metric label="Spend" value={formatSpend(campaign.spend)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string | null }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <p className="text-lg font-semibold tabular-nums">{value ?? 0}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
