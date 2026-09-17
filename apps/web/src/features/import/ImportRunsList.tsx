import { useImportRuns, type ImportRun } from "./useImportRuns.js";

const STATUS_LABEL: Record<ImportRun["status"], string> = {
  queued: "Queued",
  running: "Importing…",
  succeeded: "Done",
  partial: "Done (with rejections)",
  failed: "Failed",
};

/** AC-UX-04/05/06: explicit loading, empty, and error states — never a bare spinner or blank
 *  area indistinguishable from "there is no data here". */
export function ImportRunsList({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
}): JSX.Element {
  const { data: runs, isLoading, isError, error } = useImportRuns();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading import history…</p>;
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load import history: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }
  if (!runs || runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No imports yet — upload a file above to get started.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {runs.map((run) => {
        const pct =
          run.total_rows && run.total_rows > 0
            ? Math.min(100, Math.round((run.processed_rows / run.total_rows) * 100))
            : run.status === "succeeded"
              ? 100
              : 0;
        return (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onSelect(run.id)}
              className={`flex w-full min-h-11 flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-accent ${
                selectedId === run.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{run.filename}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    run.status === "failed"
                      ? "bg-destructive/10 text-destructive"
                      : run.status === "succeeded"
                        ? "bg-emerald-100 text-emerald-800"
                        : run.status === "partial"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {STATUS_LABEL[run.status]}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">
                {run.processed_rows.toLocaleString()}
                {run.total_rows ? ` / ${run.total_rows.toLocaleString()}` : ""} rows · {run.inserted_count.toLocaleString()} new
                · {run.updated_count.toLocaleString()} updated · {run.rejected_count.toLocaleString()} rejected ·{" "}
                {run.warning_count.toLocaleString()} warnings
              </span>
              {run.error_summary && (
                <span role="alert" className="text-xs text-destructive">
                  {run.error_summary}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
