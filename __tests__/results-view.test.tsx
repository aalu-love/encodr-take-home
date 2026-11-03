import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResultsView } from "@/components/results-view";
import type { EncodeResult } from "@/lib/types";

const result: EncodeResult = {
  durationSec: 212,
  renditions: [
    { label: "1080p", width: 1920, height: 1080, sizeMb: 48.2 },
    { label: "480p", width: 854, height: 480, sizeMb: 11.4 },
  ],
  warnings: ["Source audio was resampled to 48 kHz."],
};

describe("ResultsView", () => {
  it("shows the duration and one table row per rendition, with label, resolution, and size", () => {
    render(<ResultsView result={result} />);

    expect(screen.getByText("3:32")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1); // skip the header row
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("1080p")).toBeInTheDocument();
    expect(within(rows[0]).getByText("1920 × 1080")).toBeInTheDocument();
    expect(within(rows[0]).getByText("48.2 MB")).toBeInTheDocument();
  });

  it("lists warnings when there are some", () => {
    render(<ResultsView result={result} />);
    expect(screen.getByText("Source audio was resampled to 48 kHz.")).toBeInTheDocument();
    expect(screen.queryByText("No warnings.")).not.toBeInTheDocument();
  });

  it("says so when there are no warnings", () => {
    render(<ResultsView result={{ ...result, warnings: [] }} />);
    expect(screen.getByText("No warnings.")).toBeInTheDocument();
  });
});
