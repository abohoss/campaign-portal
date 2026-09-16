import { useState } from "react";
import { useImportErrors, IMPORT_ERRORS_PAGE_SIZE } from "./useImportErrors.js";

/** Row, field, value excerpt, and reason for every rejection/warning — "the marketer can see
 *  what didn't [load] and why, without emailing you" (done-rule 3). Paginated: a run can have
 *  thousands of these, and PostgREST truncates at 1,000 rows regardless. */
export function ImportErrorsTable({ importRunId }: { importRunId: string }): JSX.Element {
  const [page, setPage] = useState(0);
  const [severity, setSeverity] = useState<"all" | "error" | "warning">("all");
  const { data, isLoading, isError, error } = useImportErrors(importRunId, page, severity);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading errors…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load errors: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }
  if (!data || data.count === 0) {
    return <p className="text-sm text-muted-foreground">No rejections or warnings for this import.</p>;
  }

  const totalPages = Math.ceil(data.count / IMPORT_ERRORS_PAGE_SIZE);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value as typeof severity);
            setPage(0);
          }}
          className="min-h-11 rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          <option value="all">All ({data.count})</option>
          <option value="error">Rejected rows</option>
          <option value="warning">Warnings</option>
        </select>
        <span className="text-xs text-muted-foreground">
          Page {page + 1} of {totalPages}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((e, i) => (
              <tr key={i} className={e.severity === "error" ? "bg-destructive/5" : ""}>
                <td className="px-3 py-2 tabular-nums">{e.row_number}</td>
                <td className="px-3 py-2">{e.field ?? "(whole row)"}</td>
                <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs" title={e.value_excerpt ?? ""}>
                  {e.value_excerpt ?? "—"}
                </td>
                <td className="px-3 py-2">{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
          className="min-h-11 rounded-md border border-input px-3 py-1 text-sm disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="min-h-11 rounded-md border border-input px-3 py-1 text-sm disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
