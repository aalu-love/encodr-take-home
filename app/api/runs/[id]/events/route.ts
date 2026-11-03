import { error, withAuth } from "@/lib/server/http";
import { toRunEvent } from "@/lib/server/encode-run";
import { getRunRecord } from "@/lib/server/store";
import { isTerminalStage } from "@/lib/types";

export const dynamic = "force-dynamic";

const TICK_MS = 500;

/**
 * GET /api/runs/[id]/events — Server-Sent Events.
 *
 * Each event carries the run's full current state, not a delta, so a reconnecting client resumes
 * by just reading the first event. The stream sends one event immediately, then one per tick, and
 * closes after the terminal event. The timer is cleared on terminal, on client disconnect, or on
 * cancel, so nothing leaks.
 *
 * Auth: the Authorization header, enforced by withAuth like every other route.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await ctx.params;
    const record = getRunRecord(id);
    if (!record) return error(404, "Run not found");

    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const clearTimer = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const finish = () => {
          clearTimer();
          if (!closed) {
            closed = true;
            controller.close();
          }
        };

        const send = () => {
          if (closed) return;
          const event = toRunEvent(record);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (isTerminalStage(event.stage)) finish();
        };

        send();
        if (!closed) timer = setInterval(send, TICK_MS);
        req.signal.addEventListener("abort", finish, { once: true });
      },
      cancel() {
        closed = true;
        clearTimer();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  });
}
