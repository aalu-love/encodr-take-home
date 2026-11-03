import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SEC,
  authenticate,
  getUserIdFromRequest,
  issueTokens,
  verifyRefreshToken,
} from "@/lib/server/auth";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { GET as jobsGet } from "@/app/api/jobs/route";

const T0 = 1_700_000_000_000; // fixed clock so expiry is deterministic
const DEMO_ID = "u_demo";

function bearer(token: string): Request {
  return new Request("http://localhost/api/jobs", { headers: { authorization: `Bearer ${token}` } });
}

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

describe("auth routes", () => {
  it("login returns tokens and user for good credentials, 401 for bad ones", async () => {
    const ok = await loginPost(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "demo@encodr.dev", password: "password123" }),
      }),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.user.id).toBe(DEMO_ID);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));

    const bad = await loginPost(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "demo@encodr.dev", password: "nope" }),
      }),
    );
    expect(bad.status).toBe(401);
  });

  it("login returns field-level 400 errors for an invalid body", async () => {
    const res = await loginPost(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email", password: "" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors).toHaveProperty("email");
    expect(body.fieldErrors).toHaveProperty("password");
  });

  it("refresh exchanges a valid refresh token for a new access token", async () => {
    const { refreshToken } = issueTokens(DEMO_ID);
    const res = await refreshPost(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),
    );
    expect(res.status).toBe(200);
    const { accessToken } = await res.json();
    expect(getUserIdFromRequest(bearer(accessToken))).toBe(DEMO_ID);
  });

  it("protected routes return 401 without a token and reach the handler with one", async () => {
    const anonymous = await jobsGet(new Request("http://localhost/api/jobs"));
    expect(anonymous.status).toBe(401);

    const { accessToken } = issueTokens(DEMO_ID);
    const authed = await jobsGet(bearer(accessToken));
    expect(authed.status).toBe(501); // handler is still a stub; the guard let the request through
  });
});
