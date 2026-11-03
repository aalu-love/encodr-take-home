import { createJobSchema } from "@/lib/schemas";
import { error, json, readJsonBody, validationError, withAuth } from "@/lib/server/http";
import { createJob, listJobs } from "@/lib/server/store";

// GET  → Job[] (newest first)
export async function GET(req: Request) {
  return withAuth(req, () => json(listJobs()));
}

// POST { sourceUrl, title? } → 201 Job; 400 with fieldErrors if the body is invalid.
export async function POST(req: Request) {
  return withAuth(req, async () => {
    const parsed = createJobSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return validationError(parsed.error.issues);

    const job = createJob({
      sourceUrl: parsed.data.sourceUrl,
      title: parsed.data.title || undefined,
    });
    return json(job, 201);
  });
}
