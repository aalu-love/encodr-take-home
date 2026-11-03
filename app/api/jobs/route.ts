import { error, withAuth } from "@/lib/server/http";

// TODO(candidate): implement the handlers (auth guard is already in place).
//   GET  → return the list of jobs.
//   POST → validate the body with createJobSchema; on success create a job and return it (201);
//          on validation failure return field-level errors so the client can map them to the form.
export async function GET(req: Request) {
  return withAuth(req, async () => error(501, "Not implemented: GET /api/jobs"));
}

export async function POST(req: Request) {
  return withAuth(req, async () => error(501, "Not implemented: POST /api/jobs"));
}
