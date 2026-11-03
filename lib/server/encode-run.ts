import { type EncodeResult, type EncodeRun, type RunEvent, type Stage } from "@/lib/types";

// Pure encode-run state machine. No clock, no store, no I/O: everything is derived from
// (startedAt, sourceUrl, now), so the timeline can be unit-tested by passing in times directly.

/** The "magic" source URL that always fails partway, so reviewers can see the error path. */
export const FAIL_URL = "https://cdn.example.com/videos/corrupt.mp4";

export interface RunRecord {
  id: string;
  jobId: string;
  sourceUrl: string;
  startedAt: number; // epoch ms
}

type ActiveStage = Exclude<Stage, "COMPLETED" | "FAILED">;

interface StageWindow {
  stage: ActiveStage;
  startMs: number;
  endMs: number;
}

/** Total simulated run length: 30s, the middle of the brief's 20–40s range. */
export const TOTAL_DURATION_MS = 30_000;

/** When FAIL_URL runs fail: 18s in, midway through TRANSCODING. */
export const FAIL_AT_MS = 18_000;

/** Contiguous, ordered windows covering [0, TOTAL_DURATION_MS). The timeline lives in this table only. */
const STAGE_WINDOWS: readonly StageWindow[] = [
  { stage: "QUEUED", startMs: 0, endMs: 2_000 },
  { stage: "DOWNLOADING", startMs: 2_000, endMs: 8_000 },
  { stage: "PROBING", startMs: 8_000, endMs: 11_000 },
  { stage: "TRANSCODING", startMs: 11_000, endMs: 25_000 },
  { stage: "PACKAGING", startMs: 25_000, endMs: TOTAL_DURATION_MS },
];

/**
 * Internal state. Each variant carries only the fields that make sense for it, so a completed run
 * can't lack a result and a failed run can't lack an error.
 */
type RunState =
  | { kind: "active"; stage: ActiveStage; progressPct: number }
  | { kind: "completed"; result: EncodeResult }
  | { kind: "failed"; stage: ActiveStage; progressPct: number; error: string };

/** Simulated output. Fresh object each call so callers can't mutate a shared value. */
function simulatedResult(): EncodeResult {
  return {
    durationSec: 212,
    renditions: [
      { label: "1080p", width: 1920, height: 1080, sizeMb: 48.2 },
      { label: "720p", width: 1280, height: 720, sizeMb: 22.7 },
      { label: "480p", width: 854, height: 480, sizeMb: 11.4 },
    ],
    warnings: ["Source audio was resampled to 48 kHz for the AAC renditions."],
  };
}

function stageAt(elapsedMs: number): ActiveStage {
  return STAGE_WINDOWS.find((w) => elapsedMs < w.endMs)?.stage ?? "PACKAGING";
}

/** Overall progress: elapsed over total, floored so it never reaches 100 before completion. */
function progressAt(elapsedMs: number): number {
  return Math.min(100, Math.floor((elapsedMs / TOTAL_DURATION_MS) * 100));
}

function deriveState(elapsedMs: number, sourceUrl: string): RunState {
  if (sourceUrl === FAIL_URL && elapsedMs >= FAIL_AT_MS) {
    const stage = stageAt(FAIL_AT_MS);
    return {
      kind: "failed",
      stage,
      progressPct: progressAt(FAIL_AT_MS),
      error: `Failed during ${stage}: the source file is corrupt or unsupported.`,
    };
  }
  if (elapsedMs >= TOTAL_DURATION_MS) {
    return { kind: "completed", result: simulatedResult() };
  }
  return { kind: "active", stage: stageAt(elapsedMs), progressPct: progressAt(elapsedMs) };
}

function toEncodeRun(record: RunRecord, state: RunState): EncodeRun {
  const base = { id: record.id, jobId: record.jobId };
  switch (state.kind) {
    case "active":
      return { ...base, stage: state.stage, progressPct: state.progressPct };
    case "completed":
      return { ...base, stage: "COMPLETED", progressPct: 100, result: state.result };
    case "failed":
      return { ...base, stage: "FAILED", progressPct: state.progressPct, error: state.error };
  }
}

/**
 * Derive a run's current state from its record and the clock. A clock that reads earlier than
 * startedAt (skew, or a bad record) is clamped to elapsed 0, so the run reads as QUEUED.
 */
export function computeRun(record: RunRecord, now: number = Date.now()): EncodeRun {
  const elapsedMs = Math.max(0, now - record.startedAt);
  return toEncodeRun(record, deriveState(elapsedMs, record.sourceUrl));
}

/** Human-readable log line for each active stage. */
const STAGE_MESSAGES: Record<ActiveStage, string> = {
  QUEUED: "Waiting for a worker",
  DOWNLOADING: "Downloading source media",
  PROBING: "Probing streams and metadata",
  TRANSCODING: "Transcoding renditions",
  PACKAGING: "Packaging output",
};

/** The SSE payload for a run at `now`: stage, progress, a log message, and the error if it failed. */
export function toRunEvent(record: RunRecord, now: number = Date.now()): RunEvent {
  const run = computeRun(record, now);
  const message =
    run.stage === "FAILED"
      ? (run.error ?? "Encode failed")
      : run.stage === "COMPLETED"
        ? "Encode complete"
        : STAGE_MESSAGES[run.stage];
  return {
    stage: run.stage,
    progressPct: run.progressPct,
    message,
    ...(run.error ? { error: run.error } : {}),
  };
}
