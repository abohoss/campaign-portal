import type { Membership } from "../auth/useMembership.js";
import { useContacts } from "./useContacts.js";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
};

/** AC-SCALE-02: server-side keyset pagination, one page fetched at a time — never all 84k rows,
 *  never an OFFSET scan. AC-UX-04/05/06: explicit loading, empty and error states throughout. */
export function ContactsPage({ membership }: { membership: Membership }): JSX.Element {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useContacts(
    membership.brandId,
  );

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading contacts…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Couldn't load contacts: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  const contacts = (data?.pages ?? []).flat();
  if (contacts.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No contacts yet — import a file to get started.</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <h2 className="text-lg font-semibold">Contacts</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Country</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Signed up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{c.fullName ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.email ?? "—"}</td>
                <td className="px-3 py-2">{c.country ?? "—"}</td>
                <td className="px-3 py-2">{STATUS_LABEL[c.status] ?? c.status}</td>
                <td className="px-3 py-2">{c.signupAt ? new Date(c.signupAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="min-h-11 rounded-md border border-input px-4 py-2 text-sm disabled:opacity-50"
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
