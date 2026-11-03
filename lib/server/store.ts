import { randomUUID } from "node:crypto";
import { type EncodeRun, type Job, type JobStatus, isTerminalStage } from "@/lib/types";
import { computeRun, FAIL_URL, type RunRecord } from "@/lib/server/encode-run";

// In-memory store. A single Node process in `next dev`, so module-level Maps are fine.

const jobs = new Map<string, Job>();
const runs = new Map<string, RunRecord>();

// The run state machine lives in encode-run.ts (pure, unit-tested). Re-exported so existing imports keep working.
export { FAIL_URL };

/**
 * A job's status is derived from its latest run at read time, so it can't drift from the run.
 * The stored `status` is only the initial NEW value.
 */
function withDerivedStatus(job: Job, now: number = Date.now()): Job {
  const record = job.latestRunId ? runs.get(job.latestRunId) : undefined;
  if (!record) return { ...job, status: "NEW" };

  const { stage } = computeRun(record, now);
  const status: JobStatus =
    stage === "COMPLETED" ? "COMPLETED" : stage === "FAILED" ? "FAILED" : "RUNNING";
  return { ...job, status };
}

export function listJobs(now: number = Date.now()): Job[] {
  return [...jobs.values()]
    .map((job) => withDerivedStatus(job, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string, now: number = Date.now()): Job | null {
  const job = jobs.get(id);
  return job ? withDerivedStatus(job, now) : null;
}

export function createJob(input: { sourceUrl: string; title?: string }): Job {
  const id = `j_${randomUUID().slice(0, 8)}`;
  const sourceUrl = input.sourceUrl.trim();
  const job: Job = {
    id,
    title: input.title?.trim() || deriveTitle(sourceUrl),
    sourceUrl,
    status: "NEW",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

function deriveTitle(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "Untitled encode";
  } catch {
    return "Untitled encode";
  }
}

/** True if the job exists and its most recent run hasn't reached a terminal stage yet. */
export function hasActiveRun(jobId: string, now: number = Date.now()): boolean {
  const latestId = jobs.get(jobId)?.latestRunId;
  const record = latestId ? runs.get(latestId) : undefined;
  return record !== undefined && !isTerminalStage(computeRun(record, now).stage);
}

export function startRun(jobId: string): RunRecord | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  const record: RunRecord = {
    id: `r_${randomUUID().slice(0, 8)}`,
    jobId,
    sourceUrl: job.sourceUrl,
    startedAt: Date.now(),
  };
  runs.set(record.id, record);
  job.latestRunId = record.id;
  return record;
}

export function getRunRecord(id: string): RunRecord | null {
  return runs.get(id) ?? null;
}

export function getRun(id: string, now: number = Date.now()): EncodeRun | null {
  const record = runs.get(id);
  return record ? computeRun(record, now) : null;
}

export type { RunRecord };
