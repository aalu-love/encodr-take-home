import { describe, expect, it } from "vitest";
import {
  computeRun,
  FAIL_AT_MS,
  FAIL_URL,
  type RunRecord,
  TOTAL_DURATION_MS,
} from "@/lib/server/encode-run";
import { ACTIVE_STAGES, type EncodeRun, type Stage } from "@/lib/types";

const START = 1_000_000;
const OK_URL = "https://cdn.example.com/videos/sample.mp4";

function recordFor(sourceUrl: string): RunRecord {
  return { id: "r_test", jobId: "j_test", sourceUrl, startedAt: START };
}

/** Run state for a normal source, `ms` after the run started. */
function runAt(ms: number, sourceUrl = OK_URL): EncodeRun {
  return computeRun(recordFor(sourceUrl), START + ms);
}

describe("encode run state machine", () => {
  it("starts QUEUED at 0% with no result or error", () => {
    const run = runAt(0);
    expect(run.stage).toBe("QUEUED");
    expect(run.progressPct).toBe(0);
    expect(run.result).toBeUndefined();
    expect(run.error).toBeUndefined();
  });

  it("visits every stage in order, with stage and progress never going backwards", () => {
    const order: Stage[] = [...ACTIVE_STAGES, "COMPLETED"];
    const visited = new Set<Stage>();
    let lastIndex = -1;
    let lastPct = -1;

    for (let ms = 0; ms <= TOTAL_DURATION_MS + 1_000; ms += 100) {
      const run = runAt(ms);
      const index = order.indexOf(run.stage);
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      expect(run.progressPct).toBeGreaterThanOrEqual(lastPct);
      visited.add(run.stage);
      lastIndex = index;
      lastPct = run.progressPct;
    }

    expect([...visited]).toEqual(order);
  });

  it("completes exactly at the total duration, with renditions and 100%", () => {
    const justBefore = runAt(TOTAL_DURATION_MS - 1);
    expect(justBefore.stage).not.toBe("COMPLETED");

    const done = runAt(TOTAL_DURATION_MS);
    expect(done.stage).toBe("COMPLETED");
    expect(done.progressPct).toBe(100);
    expect(done.error).toBeUndefined();
    expect(done.result?.renditions.length).toBeGreaterThan(0);
  });

  it("fails the FAIL_URL run partway, freezes its progress, and stays failed", () => {
    const beforeFailure = runAt(FAIL_AT_MS - 1, FAIL_URL);
    expect(beforeFailure.stage).not.toBe("FAILED");

    const failed = runAt(FAIL_AT_MS, FAIL_URL);
    expect(failed.stage).toBe("FAILED");
    expect(failed.error).toBeTruthy();
    expect(failed.result).toBeUndefined();
    expect(failed.progressPct).toBeGreaterThan(0);
    expect(failed.progressPct).toBeLessThan(100);

    // Later clock readings must not revive or advance a failed run.
    const later = runAt(TOTAL_DURATION_MS + 60_000, FAIL_URL);
    expect(later.stage).toBe("FAILED");
    expect(later.progressPct).toBe(failed.progressPct);
  });

  it("treats a clock reading before startedAt as elapsed 0, not negative progress", () => {
    const run = runAt(-5_000);
    expect(run.stage).toBe("QUEUED");
    expect(run.progressPct).toBe(0);
  });
});
