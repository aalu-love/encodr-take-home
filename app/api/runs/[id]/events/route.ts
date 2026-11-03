import { withAuth } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * TODO(candidate): the live progress stream — the core of this exercise. Auth is in place: the
 * stream requires `Authorization: Bearer <access token>` (see lib/server/auth.ts for the decision).
 *
 * Return a Server-Sent Events stream (Content-Type: text/event-stream) that pushes the run's
 * progress as it advances, e.g.  data: {"stage":"TRANSCODING","progressPct":62,"message":"…"}\n\n
 * Close the stream once the run reaches a terminal stage (COMPLETED / FAILED), and clean up your
 * timer if the client disconnects (`req.signal`).
 */
export async function GET(req: Request, _ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => new Response("Not implemented: GET /api/runs/[id]/events", { status: 501 }));
}
