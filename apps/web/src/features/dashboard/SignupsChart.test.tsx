import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignupsChart } from "./SignupsChart.js";

describe("SignupsChart", () => {
  it("renders an accessible image with a label spanning the full date range", () => {
    render(
      <SignupsChart
        points={[
          { day: "2026-08-18", signups: 0 },
          { day: "2026-08-19", signups: 5 },
          { day: "2026-09-16", signups: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Daily signups for the last 3 days, from 2026-08-18 to 2026-09-16");
  });
});
