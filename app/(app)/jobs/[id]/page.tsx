"use client";

import { use } from "react";
import Link from "next/link";
import { useJob } from "@/lib/client/hooks";
import { ApiError } from "@/lib/client/api";
import { StatusBadge } from "@/components/status-badge";
import { RunPanel } from "@/components/run-panel";

// Still to build (phases 6–7): the live SSE progress stream (replacing the polling in RunPanel),
// a streaming log, and the results view on COMPLETED.
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

      <RunPanel job={job} />
    </div>
  );
}
