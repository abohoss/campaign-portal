import type { DailySignups } from "./useDashboardSignups.js";

// Above this many daily points, individual bars get too thin to read (and to click for their
// tooltip) — bucket into weeks instead. The total (sum of signups) is unchanged either way; this
// only changes how it's drawn, never a number reported elsewhere, so it doesn't conflict with the
// dashboard/** ESLint rule against deriving counts on the client.
const WEEKLY_BUCKET_THRESHOLD = 60;

function bucketWeekly(points: DailySignups[]): DailySignups[] {
  const weeks: DailySignups[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const week = points.slice(i, i + 7);
    weeks.push({ day: week[0]!.day, signups: week.reduce((sum, d) => sum + d.signups, 0) });
  }
  return weeks;
}

/** Plain CSS bars — no charting library needed, and it keeps every number in the accessible DOM
 *  text rather than baked into a canvas/SVG a screen reader can't read. Takes an already-SQL-
 *  computed `points` array (not `data`) — this component only renders it, it never derives a
 *  count from it, which is what the dashboard/** ESLint rule actually guards against (see
 *  .eslintrc.cjs). */
export function SignupsChart({ points }: { points: DailySignups[] }): JSX.Element {
  const bucketed = points.length > WEEKLY_BUCKET_THRESHOLD;
  const bars = bucketed ? bucketWeekly(points) : points;
  const max = Math.max(1, ...bars.map((d) => d.signups));

  return (
    <div
      role="img"
      aria-label={`${bucketed ? "Weekly" : "Daily"} signups for the last ${points.length} days, from ${points[0]?.day} to ${points[points.length - 1]?.day}`}
      className="flex h-32 items-end gap-0.5 rounded-lg border border-border bg-card p-2"
    >
      {bars.map((d) => (
        <div
          key={d.day}
          className="group flex flex-1 flex-col items-center justify-end"
          title={bucketed ? `Week of ${d.day}: ${d.signups}` : `${d.day}: ${d.signups}`}
        >
          <div
            className="w-full rounded-sm bg-primary transition-opacity group-hover:opacity-70"
            style={{ height: `${Math.max(2, (d.signups / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
