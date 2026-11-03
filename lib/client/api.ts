import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/client/token-store";
import type { RefreshResponse } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  /** Field-level errors from a 400 validation response, keyed by form field name (first message per field). */
  fieldErrors?: Record<string, string>;
  constructor(status: number, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** Fired when auth is unrecoverable. The auth provider listens for this and logs the user out. */
export const AUTH_LOGOUT_EVENT = "encodr:logout";

async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText || "Request failed";
  let fieldErrors: Record<string, string> | undefined;
  try {
    const body = await res.json();
    if (body?.detail) detail = body.detail;
    if (body?.fieldErrors) {
      fieldErrors = body.fieldErrors;
      detail = "Validation failed";
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, detail, fieldErrors);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** false for endpoints that take no token (login). Default true. */
  auth?: boolean;
}

function buildInit(options: RequestOptions, token: string | null): RequestInit {
  const headers: Record<string, string> = {};
  if (options.auth !== false && token) headers["authorization"] = `Bearer ${token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  };
}

/** Exchange the stored refresh token for a new access token. Null if that isn't possible. */
async function requestRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    // Plain fetch, not request(): a 401 here must not start another refresh.
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const { accessToken } = (await res.json()) as RefreshResponse;
    setTokens({ accessToken });
    return accessToken;
  } catch {
    return null;
  }
}

// Single-flight: every request that 401s while a refresh is running waits on that same refresh,
// so N concurrent 401s cause one refresh call, not N (no "refresh stampede").
let inFlightRefresh: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  inFlightRefresh ??= requestRefresh().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

function forceLogout(): void {
  clearTokens();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
}

/**
 * A usable access token after a 401 on a request that was sent with `sentToken`, or null (after logging
 * out) if the session can't be recovered. Shared by normal requests and the SSE stream.
 */
export async function recoverAccessToken(sentToken: string | null): Promise<string | null> {
  const current = getAccessToken();
  // Another request already refreshed since we sent this one: use the newer token, don't refresh again.
  const fresh = current && current !== sentToken ? current : await refreshOnce();
  if (!fresh) forceLogout();
  return fresh;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authed = options.auth !== false;
  const sentToken = authed ? getAccessToken() : null;
  let res = await fetch(path, buildInit(options, sentToken));

  if (authed && res.status === 401) {
    const fresh = await recoverAccessToken(sentToken);
    if (!fresh) throw await parseError(res);

    // Retry exactly once. A second 401 means the session is unrecoverable.
    res = await fetch(path, buildInit(options, fresh));
    if (res.status === 401) {
      forceLogout();
      throw await parseError(res);
    }
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  /** For endpoints that take no token (login). A 401 here is just a wrong password, not a dead session. */
  postPublic: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body, auth: false }),
};
