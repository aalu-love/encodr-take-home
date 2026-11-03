import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { clearTokens, setTokens } from "@/lib/client/token-store";
import { useRunStream } from "@/lib/client/use-run-stream";
import type { RunEvent } from "@/lib/types";

// Replace the SSE transport so each test drives the connection lifecycle directly.
const fetchEventSourceMock = vi.fn();
vi.mock("@microsoft/fetch-event-source", () => ({
  EventStreamContentType: "text/event-stream",
  fetchEventSource: (...args: unknown[]) => fetchEventSourceMock(...args),
}));

type Opts = {
  signal: AbortSignal;
  fetch: typeof fetch;
  onopen: (response: Response) => Promise<void>;
  onmessage: (message: { data: string }) => void;
};

const eventStream = () =>
  new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });

function emit(event: RunEvent) {
  return { data: JSON.stringify(event) };
}

beforeEach(() => {
  fetchEventSourceMock.mockReset();
  clearTokens();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRunStream", () => {
  it("applies events to stage, progress and log, and stops at a terminal stage", async () => {
    fetchEventSourceMock.mockImplementation(async (_url: string, opts: Opts) => {
      await opts.onopen(eventStream());
      opts.onmessage(emit({ stage: "QUEUED", progressPct: 0, message: "Waiting for a worker" }));
      opts.onmessage(emit({ stage: "QUEUED", progressPct: 0, message: "Waiting for a worker" })); // repeat: not logged twice
      opts.onmessage(emit({ stage: "DOWNLOADING", progressPct: 10, message: "Downloading source media" }));
      opts.onmessage(emit({ stage: "COMPLETED", progressPct: 100, message: "Encode complete" }));
    });
    const onTerminal = vi.fn();

    const { result } = renderHook(() => useRunStream("r_1", onTerminal));

    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.stage).toBe("COMPLETED");
    expect(result.current.progressPct).toBe(100);
    expect(result.current.log).toEqual([
      "Waiting for a worker",
      "Downloading source media",
      "Encode complete",
    ]);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed run's error", async () => {
    fetchEventSourceMock.mockImplementation(async (_url: string, opts: Opts) => {
      await opts.onopen(eventStream());
      opts.onmessage(
        emit({
          stage: "FAILED",
          progressPct: 60,
          message: "Failed during TRANSCODING",
          error: "Failed during TRANSCODING: the source file is corrupt or unsupported.",
        }),
      );
    });

    const { result } = renderHook(() => useRunStream("r_fail"));

    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.stage).toBe("FAILED");
    expect(result.current.error).toMatch(/corrupt or unsupported/);
  });

  it("closes the connection on unmount and does not reconnect", async () => {
    fetchEventSourceMock.mockImplementation(
      (_url: string, opts: Opts) =>
        new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve())),
    );

    const { unmount } = renderHook(() => useRunStream("r_unmount"));
    const { signal } = fetchEventSourceMock.mock.calls[0][1] as Opts;

    unmount();

    expect(signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
  });

  it("reconnects after a transient failure and resumes from the current state", async () => {
    let attempts = 0;
    fetchEventSourceMock.mockImplementation(async (_url: string, opts: Opts) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("network down");
      await opts.onopen(eventStream());
      opts.onmessage(emit({ stage: "PROBING", progressPct: 35, message: "Probing streams and metadata" }));
      opts.onmessage(emit({ stage: "COMPLETED", progressPct: 100, message: "Encode complete" }));
    });

    const { result } = renderHook(() => useRunStream("r_retry"));

    await waitFor(() => expect(result.current.done).toBe(true), { timeout: 4000 });
    expect(attempts).toBe(2);
    expect(result.current.stage).toBe("COMPLETED");
  });

  it("on a 401, refreshes once and retries the stream with the new token", async () => {
    setTokens({ accessToken: "T1", refreshToken: "R" });
    const seen: { url: string; auth?: string }[] = [];
    let refreshes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
        if (url === "/api/auth/refresh") {
          refreshes += 1;
          return new Response(JSON.stringify({ accessToken: "T2" }), { status: 200 });
        }
        seen.push({ url, auth });
        return auth === "Bearer T2"
          ? eventStream()
          : new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 });
      }),
    );

    fetchEventSourceMock.mockImplementation(async (url: string, opts: Opts) => {
      const response = await opts.fetch(url, { headers: { accept: "text/event-stream" } });
      await opts.onopen(response); // throws on the first attempt, after the silent refresh
      opts.onmessage(emit({ stage: "COMPLETED", progressPct: 100, message: "Encode complete" }));
    });

    const { result } = renderHook(() => useRunStream("r_auth"));

    await waitFor(() => expect(result.current.done).toBe(true), { timeout: 4000 });
    expect(refreshes).toBe(1);
    expect(seen.map((s) => s.auth)).toEqual(["Bearer T1", "Bearer T2"]);
  });
});
