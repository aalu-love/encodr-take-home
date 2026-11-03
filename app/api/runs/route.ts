import { error, withAuth } from "@/lib/server/http";

// TODO(candidate): start an encode run for { jobId } and return { runId } (201). Auth guard is in place.
export async function POST(req: Request) {
  return withAuth(req, async () => error(501, "Not implemented: POST /api/runs"));
}
