import { describe, expect, it } from "vitest";
import { issueTokens } from "@/lib/server/auth";
import { GET as listGet, POST as createPost } from "@/app/api/jobs/route";
import { GET as jobGet } from "@/app/api/jobs/[id]/route";

const DEMO_ID = "u_demo";
const CLIP = "https://cdn.example.com/videos/clip.mp4";

function authHeader(): Record<string, string> {
  const { accessToken } = issueTokens(DEMO_ID);
  return { authorization: `Bearer ${accessToken}` };
}

function postJob(body: unknown, headers: Record<string, string> = authHeader()): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("jobs API", () => {
  it("creates a job (201) with a title derived from the URL when none is given", async () => {
    const res = await createPost(postJob({ sourceUrl: CLIP }));
    expect(res.status).toBe(201);
    const job = await res.json();
    expect(job).toMatchObject({ sourceUrl: CLIP, title: "clip.mp4", status: "NEW" });
    expect(job.id).toEqual(expect.any(String));
  });

  it("uses the given title when one is provided", async () => {
    const res = await createPost(postJob({ sourceUrl: CLIP, title: "Launch video" }));
    expect((await res.json()).title).toBe("Launch video");
  });

  it("returns 400 with a field error on sourceUrl for an invalid URL, and creates nothing", async () => {
    const res = await createPost(postJob({ sourceUrl: "not a url" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.sourceUrl).toBeTruthy();
  });

  it("returns 400 for a body that isn't JSON", async () => {
    const res = await createPost(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("requires a token to create or list jobs", async () => {
    const anonymousCreate = await createPost(postJob({ sourceUrl: CLIP }, {}));
    expect(anonymousCreate.status).toBe(401);

    const anonymousList = await listGet(new Request("http://localhost/api/jobs"));
    expect(anonymousList.status).toBe(401);
  });

  it("lists created jobs, and returns one by id or 404 for an unknown id", async () => {
    const created = await (await createPost(postJob({ sourceUrl: CLIP, title: "Listed" }))).json();

    const list = await listGet(new Request("http://localhost/api/jobs", { headers: authHeader() }));
    expect(list.status).toBe(200);
    const jobs = await list.json();
    expect(jobs.some((j: { id: string }) => j.id === created.id)).toBe(true);

    const found = await jobGet(
      new Request(`http://localhost/api/jobs/${created.id}`, { headers: authHeader() }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(found.status).toBe(200);
    expect((await found.json()).title).toBe("Listed");

    const missing = await jobGet(
      new Request("http://localhost/api/jobs/j_nope", { headers: authHeader() }),
      { params: Promise.resolve({ id: "j_nope" }) },
    );
    expect(missing.status).toBe(404);
  });
});
