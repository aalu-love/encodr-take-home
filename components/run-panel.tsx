"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/client/api";
import { jobKeys, useRunResult, useStartRun } from "@/lib/client/hooks";
import { useRunStream } from "@/lib/client/use-run-stream";
import { type Job } from "@/lib/types";
import { ProgressBar } from "@/components/progress-bar";
import { ResultsView } from "@/components/results-view";
import { StatusBadge } from "@/components/status-badge";

/**
 * Start a job's encode run and watch it live over SSE. FAILED shows the error with a Retry, which
 * starts a fresh run. COMPLETED fetches the run's result and shows the results view. When the run
 * finishes, the job list is refetched so its status updates.
 */
export function RunPanel({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const start = useStartRun();
  const [startError, setStartError] = useState<string | null>(null);

  const hasRun = Boolean(job.latestRunId);
  const stream = useRunStream(job.latestRunId ?? null, () => {
    void queryClient.invalidateQueries({ queryKey: jobKeys.all });
  });

  const completed = stream.stage === "COMPLETED";
  const failed = stream.stage === "FAILED";
  const result = useRunResult(job.latestRunId ?? null, completed);
  const active = hasRun && !stream.done && !stream.error;
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
        <div className="flex items-center gap-3">
          {active && (
            <span className="text-xs text-neutral-500" aria-live="polite">
              {stream.connected ? "● Live" : "Reconnecting…"}
            </span>
          )}
          <button
            onClick={onStart}
            disabled={busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {start.isPending ? "Starting…" : failed ? "Retry encode" : "Start encode"}
          </button>
        </div>
      </div>

      {!hasRun && <p className="text-sm text-neutral-500">No run yet.</p>}
      {hasRun && stream.stage === null && !stream.error && (
        <p className="text-sm text-neutral-500">Connecting to the run…</p>
      )}

      {stream.stage && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge value={stream.stage} />
            <span className="text-sm tabular-nums text-neutral-600">{stream.progressPct}%</span>
          </div>
          <ProgressBar value={stream.progressPct} failed={failed} />
        </div>
      )}

      {completed && (
        <div className="border-t border-neutral-200 pt-4">
          {result.isPending && <p className="text-sm text-neutral-500">Loading results…</p>}
          {result.isError && (
            <p role="alert" className="text-sm text-red-600">
              Couldn’t load the results.{" "}
              <button onClick={() => result.refetch()} className="underline">
                Retry
              </button>
            </p>
          )}
          {result.data?.result && <ResultsView result={result.data.result} />}
        </div>
      )}

      {stream.error && (
        <p role="alert" className="text-sm text-red-600">
          {stream.error}
        </p>
      )}

      {stream.log.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Log</h3>
          <ol className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-neutral-50 p-3 font-mono text-xs text-neutral-700">
            {stream.log.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ol>
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
