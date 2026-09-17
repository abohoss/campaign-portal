import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase.js";

interface ShareResult {
  campaignName: string;
  channel: string;
  sentAt: string | null;
  reportedSent: number | null;
  reportedDelivered: number | null;
  reportedBounced: number | null;
  reportedOpens: number | null;
  uniqueOpens: number;
  openRate: number | null;
  bounceRate: number | null;
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/** AC-SHARE-03: wrong token and wrong password produce the identical error — this page shows one
 *  generic message for every failure mode, never distinguishing "no such link" from "bad
 *  password". No sign-in required — this route is outside AuthGate entirely (see App.tsx). */
export function SharedPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("share-view", {
        body: { token, password },
      });
      if (invokeError || !data) {
        setError("This link or password isn't valid. Check both and try again.");
        return;
      }
      setResult(data as ShareResult);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return <p className="p-4 text-sm text-muted-foreground">This link is missing its token.</p>;
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <h1 className="text-lg font-semibold">{result.campaignName}</h1>
        <p className="text-sm text-muted-foreground">
          {result.channel}
          {result.sentAt ? ` · sent ${new Date(result.sentAt).toLocaleDateString()}` : ""}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Delivered" value={result.reportedDelivered ?? 0} />
          <Metric label="Unique opens" value={result.uniqueOpens} />
          <Metric label="Open rate" value={formatRate(result.openRate)} />
          <Metric label="Bounce rate" value={formatRate(result.bounceRate)} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-4">
      <h1 className="text-lg font-semibold">Campaign results</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2">
        <label htmlFor="shared-password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="shared-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading ? "Checking…" : "View results"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
