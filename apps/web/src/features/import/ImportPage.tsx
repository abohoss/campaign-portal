import { useState } from "react";
import type { Membership } from "../auth/useMembership.js";
import { ImportUploadForm } from "./ImportUploadForm.js";
import { ImportRunsList } from "./ImportRunsList.js";
import { ImportErrorsTable } from "./ImportErrorsTable.js";

export function ImportPage({ membership }: { membership: Membership }): JSX.Element {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Import data</h2>
        <p className="text-sm text-muted-foreground">
          Upload a contacts or campaigns export. Re-uploading the same file is safe — matching
          rows are updated, not duplicated.
        </p>
      </div>

      {membership.role === "owner" ? (
        <ImportUploadForm brandId={membership.brandId} />
      ) : (
        <p className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
          Only an owner can import data. You can view import history below.
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">Recent imports</h3>
        <ImportRunsList onSelect={setSelectedRunId} selectedId={selectedRunId} />
      </div>

      {selectedRunId && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Import details</h3>
          <ImportErrorsTable importRunId={selectedRunId} />
        </div>
      )}
    </div>
  );
}
