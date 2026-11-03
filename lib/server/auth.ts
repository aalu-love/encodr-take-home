import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@/lib/types";

// Mock auth for the exercise — no identity provider, no database.
//
// Tokens are HMAC-SHA256 signed JSON claims (a minimal JWT-style format). Every token carries its
// type ("access" or "refresh"), so one can never be used where the other is expected.
//
// SSE decision: the events stream uses the same `Authorization: Bearer` header as every other route.
// The client reads it with @microsoft/fetch-event-source, which supports custom headers, so the
// stream shares the same token-attach and 401-refresh path. Native EventSource can't set headers.

export const ACCESS_TOKEN_TTL_SEC = 60;
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

// The one hard-coded user. Documented in the README.
const USERS: (User & { password: string })[] = [
  { id: "u_demo", email: "demo@encodr.dev", name: "Demo User", password: "password123" },
];

// Signing secret: AUTH_SECRET if set, otherwise a random per-process secret. The fallback lives on
// globalThis so Next's dev hot-reload doesn't regenerate it, which would invalidate every live token.
const globalForAuth = globalThis as typeof globalThis & { __encodrAuthSecret?: string };
const SECRET: string =
  process.env.AUTH_SECRET ?? (globalForAuth.__encodrAuthSecret ??= randomBytes(32).toString("base64url"));

type TokenType = "access" | "refresh";

interface Claims {
  sub: string; // user id
  typ: TokenType;
  iat: number; // seconds since epoch
  exp: number; // seconds since epoch
}

export function authenticate(email: string, password: string): User | null {
  const user = USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

export function findUser(id: string): User | null {
  const user = USERS.find((u) => u.id === id);
  if (!user) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("base64url");
}

function mint(userId: string, typ: TokenType, ttlSec: number, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const claims: Claims = { sub: userId, typ, iat, exp: iat + ttlSec };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function isClaims(value: unknown): value is Claims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sub === "string" &&
    (c.typ === "access" || c.typ === "refresh") &&
    typeof c.exp === "number"
  );
}

/** Subject of a token that is well-formed, correctly signed, unexpired, of the expected type, and whose user exists. */
function verify(token: string, expectedType: TokenType, nowMs: number): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  // Constant-time comparison of the signature.
  const expected = Buffer.from(sign(body), "base64url");
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.typ !== expectedType) return null;
  if (claims.exp * 1000 <= nowMs) return null;
  return findUser(claims.sub) ? claims.sub : null;
}

export function issueTokens(userId: string, nowMs: number = Date.now()): {
  accessToken: string;
  refreshToken: string;
} {
  return {
    accessToken: issueAccessToken(userId, nowMs),
    refreshToken: mint(userId, "refresh", REFRESH_TOKEN_TTL_SEC, nowMs),
  };
}

export function issueAccessToken(userId: string, nowMs: number = Date.now()): string {
  return mint(userId, "access", ACCESS_TOKEN_TTL_SEC, nowMs);
}

/** Return the authenticated userId from the `Authorization: Bearer <access token>` header, or null. */
export function getUserIdFromRequest(req: Request, nowMs: number = Date.now()): string | null {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match ? verify(match[1], "access", nowMs) : null;
}

/** Verify a refresh token and return its subject (userId), or null. */
export function verifyRefreshToken(token: string, nowMs: number = Date.now()): string | null {
  return verify(token, "refresh", nowMs);
}
