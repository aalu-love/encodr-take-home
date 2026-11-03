import { error, withAuth } from "@/lib/server/http";

// TODO(candidate): return the job by id (404 if missing). Auth guard is already in place.
// Note: in Next 15+, `params` is a Promise — `const { id } = await params`.
export async function GET(req: Request, _ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => error(501, "Not implemented: GET /api/jobs/[id]"));
}
