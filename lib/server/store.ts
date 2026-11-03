import { randomUUID } from "node:crypto";
import { type EncodeRun, type Job } from "@/lib/types";
import { computeRun, FAIL_URL, type RunRecord } from "@/lib/server/encode-run";

// In-memory store. A single Node process in `next dev`, so module-level Maps are fine.
//
// The job/run CRUD below is provided. The interesting part — turning an in-flight run into a
// live stage + progress over ~20–40s — is left for you.

const jobs = new Map<string, Job>();
const runs = new Map<string, RunRecord>();

// The run state machine lives in encode-run.ts (pure, unit-tested). Re-exported so existing imports keep working.
export { FAIL_URL };

// --- job/run CRUD (provided) ---

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
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
  // TODO(candidate): you'll probably also want the job's status in listJobs()/getJob() to reflect
  // its latest run (RUNNING / COMPLETED / FAILED). Decide where that derivation lives.
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
