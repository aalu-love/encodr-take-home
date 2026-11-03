import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_TOKEN_TTL_SEC,
  authenticate,
  getUserIdFromRequest,
  issueTokens,
  REFRESH_TOKEN_TTL_SEC,
  SECRET_GLOBAL_KEY,
  verifyRefreshToken,
} from "@/lib/server/auth";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { GET as jobsGet } from "@/app/api/jobs/route";
import { GET as eventsGet } from "@/app/api/runs/[id]/events/route";

const T0 = 1_700_000_000_000; // fixed clock so expiry is deterministic
const DEMO_ID = "u_demo";

function bearer(token: string): Request {
  return new Request("http://localhost/api/jobs", { headers: { authorization: `Bearer ${token}` } });
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

function claimsOf(token: string): { typ: string; iat: number; exp: number } {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

/**
 * Load a fresh copy of the auth module, as if the server had restarted (new module instance).
 * The secret fallback lives on globalThis, so it only resets when the test clears it explicitly.
 */
async function loadAuthFresh() {
  vi.resetModules();
  return await import("@/lib/server/auth");
}

/** Simulate a full process restart: module state AND the globalThis fallback secret are gone. */
function simulateProcessRestart() {
  delete (globalThis as Record<string, unknown>)[SECRET_GLOBAL_KEY];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("token issuance and verification", () => {
  it("issues an access/refresh pair that each verify for their own purpose", () => {
    const { accessToken, refreshToken } = issueTokens(DEMO_ID, T0);
    expect(getUserIdFromRequest(bearer(accessToken), T0)).toBe(DEMO_ID);
    expect(verifyRefreshToken(refreshToken, T0)).toBe(DEMO_ID);
  });

  it("never accepts a token for the wrong purpose", () => {
    const { accessToken, refreshToken } = issueTokens(DEMO_ID, T0);
    expect(verifyRefreshToken(accessToken, T0)).toBeNull();
    expect(getUserIdFromRequest(bearer(refreshToken), T0)).toBeNull();
  });

  it("expires the access token after its TTL (~60s)", () => {
    const { accessToken } = issueTokens(DEMO_ID, T0);
    const justBefore = T0 + (ACCESS_TOKEN_TTL_SEC - 1) * 1000;
    const atExpiry = T0 + ACCESS_TOKEN_TTL_SEC * 1000;
    expect(getUserIdFromRequest(bearer(accessToken), justBefore)).toBe(DEMO_ID);
    expect(getUserIdFromRequest(bearer(accessToken), atExpiry)).toBeNull();
  });

  it("gives access tokens a 60s lifetime and refresh tokens a 7-day lifetime", () => {
    const { accessToken, refreshToken } = issueTokens(DEMO_ID, T0);
    const access = claimsOf(accessToken);
    const refresh = claimsOf(refreshToken);
    expect(access.typ).toBe("access");
    expect(access.exp - access.iat).toBe(60);
    expect(refresh.typ).toBe("refresh");
    expect(refresh.exp - refresh.iat).toBe(REFRESH_TOKEN_TTL_SEC);
    expect(REFRESH_TOKEN_TTL_SEC).toBe(7 * 24 * 60 * 60);
  });

  it("rejects a token whose claims were edited (e.g. to extend its expiry)", () => {
    const { accessToken } = issueTokens(DEMO_ID, T0);
    const [body, sig] = accessToken.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    claims.exp += 3_600;
    const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`;
    expect(getUserIdFromRequest(bearer(forged), T0)).toBeNull();
  });

  it("rejects missing, non-bearer, and garbage credentials", () => {
    const none = new Request("http://localhost/api/jobs");
    const basic = new Request("http://localhost/api/jobs", { headers: { authorization: "Basic abc" } });
    expect(getUserIdFromRequest(none, T0)).toBeNull();
    expect(getUserIdFromRequest(basic, T0)).toBeNull();
    expect(getUserIdFromRequest(bearer("not.a.token"), T0)).toBeNull();
  });

  it("accepts the demo user's password and rejects anything else", () => {
    expect(authenticate("demo@encodr.dev", "password123")?.id).toBe(DEMO_ID);
    expect(authenticate("demo@encodr.dev", "wrong")).toBeNull();
    expect(authenticate("nobody@encodr.dev", "password123")).toBeNull();
  });
});

describe("signing secret across restarts", () => {
  it("with AUTH_SECRET set, a refresh token survives a restart", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-123");
    const before = await loadAuthFresh();
    const { refreshToken } = before.issueTokens(DEMO_ID);

    const afterRestart = await loadAuthFresh();
    expect(afterRestart.verifyRefreshToken(refreshToken)).toBe(DEMO_ID);
  });

  it("without AUTH_SECRET, a restart invalidates existing tokens", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    simulateProcessRestart();
    const before = await loadAuthFresh();
    const { refreshToken } = before.issueTokens(DEMO_ID);

    simulateProcessRestart();
    const afterRestart = await loadAuthFresh();
    expect(afterRestart.verifyRefreshToken(refreshToken)).toBeNull();
  });

  it("an empty AUTH_SECRET is treated as unset, not used as the signing key", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    simulateProcessRestart();
    const auth = await loadAuthFresh();
    const { refreshToken } = auth.issueTokens(DEMO_ID);
    // Forge with the empty string as the key; this must fail if the empty value were used.
    const forgedSig = (await import("node:crypto"))
      .createHmac("sha256", "")
      .update(refreshToken.split(".")[0])
      .digest("base64url");
    const forged = `${refreshToken.split(".")[0]}.${forgedSig}`;
    expect(auth.verifyRefreshToken(forged)).toBeNull();
  });

  it("a dev hot-reload (module re-evaluated, process still alive) keeps tokens valid", async () => {
    simulateProcessRestart();
    vi.unstubAllEnvs();
    const before = await loadAuthFresh();
    const { refreshToken } = before.issueTokens(DEMO_ID);

    const afterReload = await loadAuthFresh(); // same process, new module instance
    expect(afterReload.verifyRefreshToken(refreshToken)).toBe(DEMO_ID);
  });
});

describe("refresh behaviour", () => {
  it("does not rotate refresh tokens: the same one can be exchanged repeatedly (documented trade-off)", async () => {
    const { refreshToken } = issueTokens(DEMO_ID);
    for (let i = 0; i < 2; i++) {
      const res = await refreshPost(jsonPost("http://localhost/api/auth/refresh", { refreshToken }));
      expect(res.status).toBe(200);
    }
  });
});

describe("auth routes", () => {
  it("login returns tokens and user for good credentials, 401 for bad ones", async () => {
    const ok = await loginPost(
      jsonPost("http://localhost/api/auth/login", { email: "demo@encodr.dev", password: "password123" }),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.user.id).toBe(DEMO_ID);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));

    const bad = await loginPost(
      jsonPost("http://localhost/api/auth/login", { email: "demo@encodr.dev", password: "nope" }),
    );
    expect(bad.status).toBe(401);
  });

  it("login returns field-level 400 errors for an invalid body", async () => {
    const res = await loginPost(
      jsonPost("http://localhost/api/auth/login", { email: "not-an-email", password: "" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors).toHaveProperty("email");
    expect(body.fieldErrors).toHaveProperty("password");
  });

  it("an empty email reports 'Email is required', not the format message", async () => {
    const res = await loginPost(jsonPost("http://localhost/api/auth/login", { email: "", password: "x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.email).toBe("Email is required");
  });

  it("refresh exchanges a valid refresh token for a new access token", async () => {
    const { refreshToken } = issueTokens(DEMO_ID);
    const res = await refreshPost(jsonPost("http://localhost/api/auth/refresh", { refreshToken }));
    expect(res.status).toBe(200);
    const { accessToken } = await res.json();
    expect(getUserIdFromRequest(bearer(accessToken))).toBe(DEMO_ID);
  });

  it("protected routes return 401 without a token and reach the handler with one", async () => {
    const anonymous = await jobsGet(new Request("http://localhost/api/jobs"));
    expect(anonymous.status).toBe(401);

    const { accessToken } = issueTokens(DEMO_ID);
    const authed = await jobsGet(bearer(accessToken));
    expect(authed.status).toBe(200); // the guard let the request through to the jobs list
  });

  it("the SSE events stream requires the Authorization header; a token in the query string is ignored", async () => {
    const ctx = { params: Promise.resolve({ id: "r_x" }) };
    const { accessToken } = issueTokens(DEMO_ID);

    const anonymous = await eventsGet(new Request("http://localhost/api/runs/r_x/events"), ctx);
    expect(anonymous.status).toBe(401);

    const queryOnly = await eventsGet(
      new Request(`http://localhost/api/runs/r_x/events?access_token=${accessToken}`),
      ctx,
    );
    expect(queryOnly.status).toBe(401);

    const authed = await eventsGet(
      new Request("http://localhost/api/runs/r_x/events", {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      ctx,
    );
    expect(authed.status).toBe(404); // "r_x" doesn't exist; the guard passed the request through
  });
});
