import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountingNote } from "./CountingNote.js";

describe("CountingNote", () => {
  it("renders its counting-rule text (done-rule 4)", () => {
    render(<CountingNote>Blank consent counts as not contactable.</CountingNote>);
    expect(screen.getByText("Blank consent counts as not contactable.")).toBeInTheDocument();
  });
});
