"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { CreateJobInput } from "@/lib/schemas";
import type { EncodeRun, Job } from "@/lib/types";

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
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

/** One-shot fetch of a run's current state. Live progress comes from useRunStream instead. */
export function fetchRun(runId: string) {
  return api.get<EncodeRun>(`/api/runs/${runId}`);
}

export const runKeys = {
  detail: (id: string) => ["runs", id] as const,
};

/**
 * The finished run's result (renditions, duration, warnings), fetched from the server once the
 * stream reports COMPLETED. The stream itself doesn't carry the result.
 */
export function useRunResult(runId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: runKeys.detail(runId ?? ""),
    queryFn: () => fetchRun(runId ?? ""),
    enabled: enabled && Boolean(runId),
  });
}
