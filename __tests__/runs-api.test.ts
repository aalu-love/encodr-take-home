import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueTokens } from "@/lib/server/auth";
import { FAIL_AT_MS, FAIL_URL, TOTAL_DURATION_MS } from "@/lib/server/encode-run";
import { POST as createJobPost } from "@/app/api/jobs/route";
import { GET as jobGet } from "@/app/api/jobs/[id]/route";
import { POST as startRunPost } from "@/app/api/runs/route";
import { GET as runGet } from "@/app/api/runs/[id]/route";

const T0 = 1_700_000_000_000;
const OK_URL = "https://cdn.example.com/videos/clip.mp4";

// Fake only Date: store timestamps and run progress both read Date.now().
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Move the clock to `ms` after T0. */
function at(ms: number) {
  vi.setSystemTime(T0 + ms);
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${issueTokens("u_demo").accessToken}` };
}

async function createJob(sourceUrl: string): Promise<string> {
  const res = await createJobPost(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth() },
      body: JSON.stringify({ sourceUrl }),
    }),
  );
  return (await res.json()).id;
}

function startRun(jobId: string | unknown): Promise<Response> {
  return startRunPost(
    new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth() },
      body: JSON.stringify({ jobId }),
    }),
  );
}

function getRun(runId: string): Promise<Response> {
  return runGet(new Request(`http://localhost/api/runs/${runId}`, { headers: auth() }), {
    params: Promise.resolve({ id: runId }),
  });
}

function getJob(jobId: string): Promise<Response> {
  return jobGet(new Request(`http://localhost/api/jobs/${jobId}`, { headers: auth() }), {
    params: Promise.resolve({ id: jobId }),
  });
}

describe("starting runs", () => {
  it("starts a run (201), reports it QUEUED, and marks the job RUNNING", async () => {
    const jobId = await createJob(OK_URL);
    const res = await startRun(jobId);
    expect(res.status).toBe(201);
    const { runId } = await res.json();

    expect((await (await getRun(runId)).json()).stage).toBe("QUEUED");
    expect((await (await getJob(jobId)).json()).status).toBe("RUNNING");
  });

  it("rejects an unknown job (404), an invalid body (400), and an anonymous caller (401)", async () => {
    expect((await startRun("j_missing")).status).toBe(404);

    const invalid = await startRun(undefined);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).fieldErrors.jobId).toBeTruthy();

    const anonymous = await startRunPost(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: "j_any" }),
      }),
    );
    expect(anonymous.status).toBe(401);
  });

  it("refuses a second run while one is in progress (409), and allows one after it finishes", async () => {
    const jobId = await createJob(OK_URL);
    expect((await startRun(jobId)).status).toBe(201);

    at(10_000);
    expect((await startRun(jobId)).status).toBe(409);

    at(TOTAL_DURATION_MS + 1);
    expect((await startRun(jobId)).status).toBe(201);
  });
});

describe("run lifecycle and derived job status", () => {
  it("a normal run completes with a result, and the job becomes COMPLETED", async () => {
    const jobId = await createJob(OK_URL);
    const { runId } = await (await startRun(jobId)).json();

    at(TOTAL_DURATION_MS - 1);
    expect((await (await getRun(runId)).json()).stage).not.toBe("COMPLETED");

    at(TOTAL_DURATION_MS);
    const run = await (await getRun(runId)).json();
    expect(run.stage).toBe("COMPLETED");
    expect(run.result.renditions.length).toBeGreaterThan(0);
    expect((await (await getJob(jobId)).json()).status).toBe("COMPLETED");
  });

  it("the magic URL fails partway: the job becomes FAILED and a retry starts a fresh run", async () => {
    const jobId = await createJob(FAIL_URL);
    const { runId } = await (await startRun(jobId)).json();

    at(FAIL_AT_MS - 1);
    expect((await (await getJob(jobId)).json()).status).toBe("RUNNING");

    at(FAIL_AT_MS);
    const failed = await (await getRun(runId)).json();
    expect(failed.stage).toBe("FAILED");
    expect(failed.error).toBeTruthy();
    expect((await (await getJob(jobId)).json()).status).toBe("FAILED");

    const retry = await startRun(jobId);
    expect(retry.status).toBe(201);
    expect((await retry.json()).runId).not.toBe(runId);
  });

  it("exposes a result only once the run has completed, with renditions and warnings", async () => {
    const jobId = await createJob(OK_URL);
    const { runId } = await (await startRun(jobId)).json();

    at(TOTAL_DURATION_MS / 2);
    expect((await (await getRun(runId)).json()).result).toBeUndefined();

    at(TOTAL_DURATION_MS);
    const done = await (await getRun(runId)).json();
    expect(done.result.durationSec).toBeGreaterThan(0);
    expect(done.result.renditions.map((r: { label: string }) => r.label)).toEqual(["1080p", "720p", "480p"]);
    expect(done.result.warnings.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown run id", async () => {
    expect((await getRun("r_missing")).status).toBe(404);
  });
});
