"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { CreateJobInput } from "@/lib/schemas";
import { isTerminalStage, type EncodeRun, type Job } from "@/lib/types";

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
};

export const runKeys = {
  detail: (id: string) => ["runs", id] as const,
};

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: ({ signal }) => api.get<Job[]>("/api/jobs", signal),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) => api.get<Job>(`/api/jobs/${id}`, signal),
  });
}

/** Create a job. On success the job list is refetched so the new row appears without a reload. */
export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJobInput) => api.post<Job>("/api/jobs", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

/** Start a run for a job. Resolves to the new run's id. Refetches jobs so `latestRunId` updates. */
export function useStartRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<{ runId: string }>("/api/runs", { jobId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

/** Imperative one-shot fetch of a run's current state. */
export function fetchRun(runId: string) {
  return api.get<EncodeRun>(`/api/runs/${runId}`);
}

/**
 * Current state of one run. Polls once a second until the run is terminal.
 * Phase 6 replaces this polling with the SSE stream; the terminal-state handling stays the same.
 */
export function useRun(runId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: runKeys.detail(runId ?? ""),
    queryFn: () => fetchRun(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (q) => (q.state.data && isTerminalStage(q.state.data.stage) ? false : 1000),
  });

  // When the run finishes, the job's derived status has changed too: refetch the jobs.
  const terminal = query.data ? isTerminalStage(query.data.stage) : false;
  useEffect(() => {
    if (terminal) void queryClient.invalidateQueries({ queryKey: jobKeys.all });
  }, [terminal, queryClient]);

  return query;
}
