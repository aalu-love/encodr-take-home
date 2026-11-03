import { error, withAuth } from "@/lib/server/http";

// TODO(candidate): return the current EncodeRun by id (404 if missing). Auth guard is in place.
export async function GET(req: Request, _ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => error(501, "Not implemented: GET /api/runs/[id]"));
}
