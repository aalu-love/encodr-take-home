import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueTokens } from "@/lib/server/auth";
import { TOTAL_DURATION_MS } from "@/lib/server/encode-run";
import { POST as createJobPost } from "@/app/api/jobs/route";
import { POST as startRunPost } from "@/app/api/runs/route";
import { GET as eventsGet } from "@/app/api/runs/[id]/events/route";
import type { RunEvent } from "@/lib/types";

const T0 = 1_700_000_000_000;
const OK_URL = "https://cdn.example.com/videos/clip.mp4";

// Fake everything (Date and timers) so the stream's interval can be stepped and counted.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

function auth(): Record<string, string> {
  return { authorization: `Bearer ${issueTokens("u_demo").accessToken}` };
}

async function startRun(): Promise<string> {
  const job = await (
    await createJobPost(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth() },
        body: JSON.stringify({ sourceUrl: OK_URL }),
      }),
    )
  ).json();
  const run = await (
    await startRunPost(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth() },
        body: JSON.stringify({ jobId: job.id }),
      }),
    )
  ).json();
  return run.runId;
}

function openStream(runId: string, signal?: AbortSignal): Promise<Response> {
  return eventsGet(
    new Request(`http://localhost/api/runs/${runId}/events`, { headers: auth(), signal }),
    { params: Promise.resolve({ id: runId }) },
  );
}

/** Parse the complete `data:` frames in an SSE chunk. */
function parseFrames(text: string): RunEvent[] {
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)) as RunEvent);
}

describe("GET /api/runs/[id]/events", () => {
  it("is an event stream, sends the current state immediately, and ticks one timer while open", async () => {
    const runId = await startRun();
    const res = await openStream(runId);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = parseFrames(decoder.decode((await reader.read()).value));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ stage: "QUEUED", progressPct: 0, message: "Waiting for a worker" });
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(500);
    const next = parseFrames(decoder.decode((await reader.read()).value));
    expect(next[0].stage).toBe("QUEUED");

    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0); // the client disconnected: no timer left behind
  });

  it("streams a full run in order, then closes on its own with the timer cleared", async () => {
    const runId = await startRun();
    const res = await openStream(runId);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const events: RunEvent[] = parseFrames(decoder.decode((await reader.read()).value));
    let closed = false;
    for (let tick = 0; tick < 200 && !closed; tick++) {
      vi.advanceTimersByTime(500); // each tick enqueues exactly one event, so the next read never blocks
      const chunk = await reader.read();
      if (chunk.done) {
        closed = true;
      } else {
        events.push(...parseFrames(decoder.decode(chunk.value)));
      }
    }

    expect(closed).toBe(true);
    expect(events[events.length - 1].stage).toBe("COMPLETED");
    expect(events[events.length - 1].progressPct).toBe(100);

    const stages = [...new Set(events.map((e) => e.stage))];
    expect(stages).toEqual(["QUEUED", "DOWNLOADING", "PROBING", "TRANSCODING", "PACKAGING", "COMPLETED"]);

    const progress = events.map((e) => e.progressPct);
    expect(progress).toEqual([...progress].sort((a, b) => a - b)); // never goes backwards
    expect(vi.getTimerCount()).toBe(0);
    expect(TOTAL_DURATION_MS).toBeGreaterThan(0);
  });

  it("clears its timer when the request is aborted (the client went away)", async () => {
    const runId = await startRun();
    const controller = new AbortController();
    const res = await openStream(runId, controller.signal);
    await res.body!.getReader().read();
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires the Authorization header", async () => {
    const runId = await startRun();
    const res = await eventsGet(new Request(`http://localhost/api/runs/${runId}/events`), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(401);
  });
});
