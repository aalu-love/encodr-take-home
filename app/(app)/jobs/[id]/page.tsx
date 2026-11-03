"use client";

import { use } from "react";
import Link from "next/link";
import { useJob } from "@/lib/client/hooks";
import { ApiError } from "@/lib/client/api";
import { StatusBadge } from "@/components/status-badge";

// TODO(candidate): this is the core screen. Build:
//  - a "Start encode" action (POST /api/runs) that kicks off a run,
//  - a live progress indicator (stage + %) driven by the SSE stream (useRunStream),
//  - a streaming log of messages,
//  - a clear FAILED state with a Retry,
//  - a results view once the run COMPLETES (renditions / duration / warnings).
// Make sure the stream is cleaned up on unmount/navigation, and the job's status in the list
// reflects the terminal state.
export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const jobQuery = useJob(id);

  if (jobQuery.isLoading) return <p className="text-sm text-neutral-500">Loading job…</p>;
  if (jobQuery.isError || !jobQuery.data) {
    const notFound = jobQuery.error instanceof ApiError && jobQuery.error.status === 404;
    return (
      <div className="text-sm text-red-600">
        {notFound ? "Job not found." : "Couldn’t load this job."}{" "}
        {!notFound && (
          <button onClick={() => jobQuery.refetch()} className="underline">
            Retry
          </button>
        )}{" "}
        <Link href="/jobs" className="underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const job = jobQuery.data;

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">
        ← All jobs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{job.title}</h1>
          <p className="truncate text-sm text-neutral-500">{job.sourceUrl}</p>
        </div>
        <StatusBadge value={job.status} />
      </div>

      <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
        TODO(candidate): run controls, live progress (SSE), log, failure/retry, and results view.
      </p>
    </div>
  );
}
