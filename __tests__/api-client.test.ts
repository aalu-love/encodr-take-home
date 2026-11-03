import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, AUTH_LOGOUT_EVENT } from "@/lib/client/api";
import { clearTokens, getAccessToken, setTokens } from "@/lib/client/token-store";

/**
 * Fake backend. It only accepts `validAccess` as a bearer token and only `validRefresh` on
 * /api/auth/refresh, and it counts calls so tests can assert how many refreshes happened.
 */
function fakeBackend(opts: { validAccess: string; validRefresh: string; newAccess?: string }) {
  const calls = { refresh: 0, jobs: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url === "/api/auth/refresh") {
        calls.refresh++;
        const { refreshToken } = JSON.parse(String(init?.body));
        if (refreshToken !== opts.validRefresh) {
          return new Response(JSON.stringify({ detail: "Invalid or expired refresh token" }), {
            status: 401,
          });
        }
        return new Response(JSON.stringify({ accessToken: opts.newAccess ?? "T2" }), { status: 200 });
      }
      if (url === "/api/jobs") {
        calls.jobs++;
        if (headers.authorization !== `Bearer ${opts.validAccess}`) {
          return new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return calls;
}

let logoutListener: ReturnType<typeof vi.fn<(event: Event) => void>>;

beforeEach(() => {
  clearTokens();
  localStorage.clear();
  logoutListener = vi.fn<(event: Event) => void>();
  window.addEventListener(AUTH_LOGOUT_EVENT, logoutListener);
});

afterEach(() => {
  window.removeEventListener(AUTH_LOGOUT_EVENT, logoutListener);
  vi.unstubAllGlobals();
});

describe("API client auth", () => {
  it("attaches the access token and does not refresh when the token is valid", async () => {
    setTokens({ accessToken: "T2", refreshToken: "R" });
    const calls = fakeBackend({ validAccess: "T2", validRefresh: "R" });

    await expect(api.get("/api/jobs")).resolves.toEqual([]);
    expect(calls.refresh).toBe(0);
    expect(logoutListener).not.toHaveBeenCalled();
  });

  it("on a 401, refreshes once and retries the original request with the new token", async () => {
    setTokens({ accessToken: "T1", refreshToken: "R" }); // expired on the server
    const calls = fakeBackend({ validAccess: "T2", validRefresh: "R" });

    await expect(api.get("/api/jobs")).resolves.toEqual([]);
    expect(calls.refresh).toBe(1);
    expect(calls.jobs).toBe(2); // original + one retry
    expect(getAccessToken()).toBe("T2");
  });

  it("concurrent 401s share one in-flight refresh instead of stampeding", async () => {
    setTokens({ accessToken: "T1", refreshToken: "R" });
    const calls = fakeBackend({ validAccess: "T2", validRefresh: "R" });

    const results = await Promise.all([api.get("/api/jobs"), api.get("/api/jobs"), api.get("/api/jobs")]);

    expect(results).toEqual([[], [], []]);
    expect(calls.refresh).toBe(1);
  });

  it("when the refresh fails, clears the session and signals logout", async () => {
    setTokens({ accessToken: "T1", refreshToken: "R-stale" });
    fakeBackend({ validAccess: "T2", validRefresh: "R" });

    const error = await api.get("/api/jobs").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("encodr.refreshToken")).toBeNull();
    expect(logoutListener).toHaveBeenCalledTimes(1);
  });

  it("retries only once: a second 401 after refreshing logs out instead of looping", async () => {
    setTokens({ accessToken: "T1", refreshToken: "R" });
    const calls = fakeBackend({ validAccess: "never-issued", validRefresh: "R" });

    await expect(api.get("/api/jobs")).rejects.toMatchObject({ status: 401 });
    expect(calls.refresh).toBe(1);
    expect(calls.jobs).toBe(2);
    expect(logoutListener).toHaveBeenCalledTimes(1);
  });

  it("a wrong password on login is a plain 401, not a refresh or a logout", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ detail: "Invalid email or password" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await api.postPublic("/api/auth/login", { email: "a@b.co", password: "x" }).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ status: 401, message: "Invalid email or password" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt
    expect(logoutListener).not.toHaveBeenCalled();
  });
});
