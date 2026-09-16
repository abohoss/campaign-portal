import type { DailySignups } from "./useDashboardSignups.js";

/** Plain CSS bars — no charting library needed for 30 fixed-width columns, and it keeps every
 *  number in the accessible DOM text rather than baked into a canvas/SVG a screen reader can't
 *  read. Takes an already-SQL-computed `points` array (not `data`) — this component only renders
 *  it, it never derives a count from it, which is what the dashboard/** ESLint rule actually
 *  guards against (see .eslintrc.cjs). */
export function SignupsChart({ points }: { points: DailySignups[] }): JSX.Element {
  const max = Math.max(1, ...points.map((d) => d.signups));

  return (
    <div
      role="img"
      aria-label={`Daily signups for the last ${points.length} days, from ${points[0]?.day} to ${points[points.length - 1]?.day}`}
      className="flex h-32 items-end gap-0.5 rounded-lg border border-border p-2"
    >
      {points.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.signups}`}>
          <div
            className="w-full rounded-sm bg-primary"
            style={{ height: `${Math.max(2, (d.signups / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
