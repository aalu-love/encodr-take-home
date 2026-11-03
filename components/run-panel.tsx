"use client";

import { useState } from "react";
import { ApiError } from "@/lib/client/api";
import { useRun, useStartRun } from "@/lib/client/hooks";
import { isTerminalStage, type Job } from "@/lib/types";
import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";

/**
 * Start / monitor a job's encode run. Progress comes from polling for now (phase 5).
 * FAILED shows the error with a Retry, which starts a fresh run.
 */
export function RunPanel({ job }: { job: Job }) {
  const run = useRun(job.latestRunId);
  const start = useStartRun();
  const [startError, setStartError] = useState<string | null>(null);

  const current = run.data;
  const active = current !== undefined && !isTerminalStage(current.stage);
  const failed = current?.stage === "FAILED";
  const busy = start.isPending || active;

  async function onStart() {
    setStartError(null);
    try {
      await start.mutateAsync(job.id);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "Couldn’t start the run. Try again.");
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">Encode run</h2>
        <button
          onClick={onStart}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {start.isPending ? "Starting…" : failed ? "Retry encode" : "Start encode"}
        </button>
      </div>

      {!job.latestRunId && <p className="text-sm text-neutral-500">No run yet.</p>}
      {job.latestRunId && run.isLoading && <p className="text-sm text-neutral-500">Loading run…</p>}
      {job.latestRunId && run.isError && (
        <p className="text-sm text-red-600">Couldn’t load run progress.</p>
      )}

      {current && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge value={current.stage} />
            <span className="text-sm tabular-nums text-neutral-600">{current.progressPct}%</span>
          </div>
          <ProgressBar value={current.progressPct} failed={failed} />
          {failed && (
            <p role="alert" className="text-sm text-red-600">
              {current.error ?? "The encode failed."}
            </p>
          )}
          {current.stage === "COMPLETED" && (
            <p className="text-sm text-green-700">Encode finished.</p>
          )}
        </div>
      )}

      {startError && (
        <p role="alert" className="text-sm text-red-600">
          {startError}
        </p>
      )}
    </section>
  );
}
