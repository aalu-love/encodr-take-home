"use client";

import { useEffect, useRef, useState } from "react";
import { EventStreamContentType, fetchEventSource } from "@microsoft/fetch-event-source";
import { recoverAccessToken } from "@/lib/client/api";
import { getAccessToken } from "@/lib/client/token-store";
import { isTerminalStage, type RunEvent, type Stage } from "@/lib/types";

export interface RunStreamState {
  stage: Stage | null;
  progressPct: number;
  log: string[];
  error: string | null;
  connected: boolean;
  done: boolean;
}

const initialState: RunStreamState = {
  stage: null,
  progressPct: 0,
  log: [],
  error: null,
  connected: false,
  done: false,
};

/** Ends the reconnect loop for good (session gone, run not found). Any other failure is retried. */
class StreamFatalError extends Error {}

const MAX_BACKOFF_MS = 8_000;

/** Sleep that wakes early (and clears its timer) when the stream is aborted, so nothing leaks on unmount. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function applyEvent(state: RunStreamState, event: RunEvent): RunStreamState {
  const terminal = isTerminalStage(event.stage);
  const last = state.log[state.log.length - 1];
  return {
    stage: event.stage,
    progressPct: event.progressPct,
    // Each stage emits its message on every tick; only log a line when it changes.
    log: event.message && event.message !== last ? [...state.log, event.message] : state.log,
    error: event.error ?? null,
    connected: !terminal,
    done: terminal,
  };
}

/**
 * Live state of a run, from the SSE stream at /api/runs/:id/events.
 *
 * - Updates stage, progress, and log as events arrive; `done` is set on a terminal stage, and
 *   `onTerminal` fires once so the caller can refetch (e.g. the job list).
 * - Reconnects after a transient failure with exponential backoff. Each event carries the full
 *   state, so a reconnect resumes from the current stage.
 * - A 401 triggers one silent refresh, then a retry with the new token (shared with the API client).
 * - Unmount, or a change of runId, aborts the connection and any pending retry timer.
 */
export function useRunStream(runId: string | null, onTerminal?: () => void): RunStreamState {
  const [state, setState] = useState<RunStreamState>(initialState);
  const onTerminalRef = useRef(onTerminal);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    setState(initialState);
    if (!runId) return;

    const controller = new AbortController();
    const { signal } = controller;
    let finished = false;
    let attempt = 0;
    let lastToken: string | null = null;

    const update = (next: (s: RunStreamState) => RunStreamState) => {
      if (!signal.aborted) setState(next);
    };

    // fetch-event-source copies the headers once, when the stream starts. Injecting the token per
    // request means a retry after a refresh sends the new token.
    const authedFetch: typeof fetch = (input, init) => {
      lastToken = getAccessToken();
      const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
      };
      if (lastToken) headers.authorization = `Bearer ${lastToken}`;
      return fetch(input, { ...init, headers });
    };

    // One connection. Resolves on a clean close or abort; rejects on any error.
    const connectOnce = () =>
      fetchEventSource(`/api/runs/${runId}/events`, {
        signal,
        openWhenHidden: true,
        fetch: authedFetch,
        async onopen(response) {
          if (response.ok && response.headers.get("content-type")?.startsWith(EventStreamContentType)) {
            update((s) => ({ ...s, connected: true }));
            return;
          }
          if (response.status === 401) {
            const fresh = await recoverAccessToken(lastToken);
            if (!fresh) throw new StreamFatalError("Your session expired. Please sign in again.");
            throw new Error("Session refreshed; retrying the stream");
          }
          if (response.status === 404) throw new StreamFatalError("This run no longer exists.");
          throw new Error(`Stream request failed (${response.status})`);
        },
        onmessage(message) {
          if (signal.aborted) return;
          let event: RunEvent;
          try {
            event = JSON.parse(message.data) as RunEvent;
          } catch {
            return; // ignore a malformed frame; the next one carries the full state anyway
          }
          attempt = 0;
          update((s) => applyEvent(s, event));

          if (isTerminalStage(event.stage)) {
            finished = true;
            controller.abort(); // the server has closed too; stop the loop and the connection
            onTerminalRef.current?.();
          }
        },
        // Rethrow so the promise rejects and the loop below decides whether to retry.
        onerror(error) {
          throw error;
        },
      });

    void (async () => {
      while (!signal.aborted && !finished) {
        try {
          await connectOnce();
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof StreamFatalError) {
            update((s) => ({ ...s, connected: false, error: error.message }));
            return;
          }
          // Transient failure: fall through to the backoff and reconnect.
        }
        if (signal.aborted || finished) return;

        update((s) => ({ ...s, connected: false }));
        attempt += 1;
        await wait(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (attempt - 1)), signal);
      }
    })();

    return () => controller.abort();
  }, [runId]);

  return state;
}
