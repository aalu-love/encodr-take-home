import { describe, expect, it } from "vitest";
import { formatDuration, formatSize } from "@/lib/format";

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [9, "0:09"],
    [212, "3:32"],
    [3599, "59:59"],
    [3725, "1:02:05"],
  ])("formats %i seconds as %s", (sec, expected) => {
    expect(formatDuration(sec)).toBe(expected);
  });

  it("rounds to the nearest second and never goes negative", () => {
    expect(formatDuration(59.6)).toBe("1:00");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("formatSize", () => {
  it("shows megabytes to one decimal place", () => {
    expect(formatSize(48.2)).toBe("48.2 MB");
    expect(formatSize(11)).toBe("11.0 MB");
  });
});
