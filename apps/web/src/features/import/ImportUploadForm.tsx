import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { importFormSchema, startImport } from "./start-import.js";

/** Owner-only by convention of where it's rendered (ImportPage checks membership.role) — the
 *  real gate is server-side (Storage RLS + import-start's own membership check), this is just UX
 *  so an analyst never sees a form they'd be rejected from using anyway. */
export function ImportUploadForm({ brandId }: { brandId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"contacts" | "campaigns">("contacts");
  const [file, setFile] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setFieldError(null);

    const parsed = importFormSchema.safeParse({ kind, file });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.file?.[0] ?? "Invalid input");
      return; // rejected before any upload — AC-UX-01
    }

    setSubmitting(true);
    try {
      await startImport(brandId, parsed.data.kind, parsed.data.file);
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: ["import-runs"] });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Import failed to start");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="import-kind" className="block text-sm font-medium">
            File type
          </label>
          <select
            id="import-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "contacts" | "campaigns")}
            className="mt-1 min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="contacts">Contacts</option>
            <option value="campaigns">Campaigns</option>
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="import-file" className="block text-sm font-medium">
            CSV file
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-accent"
            aria-invalid={!!fieldError}
            aria-describedby={fieldError ? "import-file-error" : undefined}
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Uploading…" : "Import"}
        </button>
      </div>
      {fieldError && (
        <p id="import-file-error" className="text-sm text-destructive">
          {fieldError}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
    </form>
  );
}
