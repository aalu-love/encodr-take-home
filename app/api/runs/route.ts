import { startRunSchema } from "@/lib/schemas";
import { error, json, readJsonBody, validationError, withAuth } from "@/lib/server/http";
import { getJob, hasActiveRun, startRun } from "@/lib/server/store";

// POST { jobId } → 201 { runId }
// 400 if the body is invalid, 404 if the job doesn't exist, 409 if its latest run is still in progress.
export async function POST(req: Request) {
  return withAuth(req, async () => {
    const parsed = startRunSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return validationError(parsed.error.issues);

    const { jobId } = parsed.data;
    if (!getJob(jobId)) return error(404, "Job not found");
    if (hasActiveRun(jobId)) return error(409, "This job already has a run in progress");

    const run = startRun(jobId);
    if (!run) return error(404, "Job not found");
    return json({ runId: run.id }, 201);
  });
}
