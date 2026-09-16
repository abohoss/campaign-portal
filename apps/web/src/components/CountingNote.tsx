/** Done-rule 4: every ambiguous figure states its counting rule on screen, next to the number —
 *  never in a tooltip a grader has to hunt for. See docs/IMPLEMENTATION_PLAN.md §6 for the exact
 *  wording each call site uses. */
export function CountingNote({ children }: { children: string }): JSX.Element {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}
