# Encodr — Transcoding Dashboard

A signed-in user creates an encode **job** from a media URL, starts a **run**, watches its progress
**live** over Server-Sent Events, and sees the **renditions** when it finishes (or a clear error and a
retry if it fails). Built to the brief in [`BRIEF.md`](BRIEF.md).

## Run it

```bash
npm install
npm run dev         # http://localhost:3000
npm run test:run    # unit + component + API tests (75)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # production build
```

- **Node:** the brief asks for 20+. I developed and tested on **Node 24.15**. `.nvmrc` pins 20; I haven't
  re-run the suite on 20.
- **Demo login:** `demo@encodr.dev` / `password123`
- **Optional env:** `AUTH_SECRET` signs tokens. If unset, a random secret is generated per process, so
  restarting the server signs everyone out. Set it to keep sessions across restarts.

### Try the flow

1. Sign in, then create a job with a URL such as `https://cdn.example.com/videos/clip.mp4`.
2. Open the job and click **Start encode**. The log and progress stream in live, and the run completes
   after about 30 seconds with a results table and warnings.
3. To see the error path, use the **magic URL** `https://cdn.example.com/videos/corrupt.mp4`. It fails at
   18 seconds in TRANSCODING. Click **Retry encode** to start a fresh run.

## Layout

```
app/api/auth/{login,refresh}   token issue + silent refresh
app/api/jobs[/id]              list, create, detail (auth-guarded)
app/api/runs[/id]              start a run, run state
app/api/runs/[id]/events       SSE progress stream
lib/server/auth.ts             HMAC-signed access/refresh tokens, constant-time password check
lib/server/encode-run.ts       pure run state machine (stage, progress, error, result, log lines)
lib/server/store.ts            in-memory jobs/runs; derives job status from the latest run
lib/server/http.ts             JSON helpers, field-level 400s, withAuth guard, body size limit
lib/client/api.ts              fetch wrapper: 401 → one refresh → one retry; single-flight refresh
lib/client/use-run-stream.ts   SSE hook: reconnect, token refresh, cleanup on unmount
lib/client/auth-context.tsx    login/logout, global logout on unrecoverable auth
lib/schemas.ts                 Zod schemas shared by client forms and server validation
lib/types.ts                   the API contract, shared by client and server
```

## API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` → `{ accessToken, refreshToken, user }`; 400 with `fieldErrors`; 401 on bad credentials |
| POST | `/api/auth/refresh` | — | `{ refreshToken }` → `{ accessToken }`; 401 if invalid or expired |
| GET | `/api/jobs` | ✓ | Jobs, newest first; status derived from the latest run |
| POST | `/api/jobs` | ✓ | `{ sourceUrl, title? }` → 201 Job; 400 with `fieldErrors` |
| GET | `/api/jobs/:id` | ✓ | 404 if missing |
| POST | `/api/runs` | ✓ | `{ jobId }` → 201 `{ runId }`; 404 unknown job; 409 if its latest run is still active |
| GET | `/api/runs/:id` | ✓ | Run state; `result` appears once COMPLETED; 404 if missing |
| GET | `/api/runs/:id/events` | ✓ | `text/event-stream` of run state; closes after a terminal event |

Errors use `{ detail }`, and validation failures add `fieldErrors` (one message per field).

## Design decisions

### Authentication

- **Tokens** are HMAC-SHA256 signed JSON claims (`sub`, `typ`, `iat`, `exp`), built with `node:crypto`. The
  access token lives 60 seconds and the refresh token 7 days. Every token carries its **type**, so an
  access token is rejected at the refresh endpoint and a refresh token is rejected at every guarded route.
- Signatures are compared in constant time. Passwords are compared by hashing both sides first, so
  neither the comparison time nor the length leaks.
- **Protected routes** all go through `withAuth`, so unauthenticated requests get a 401 before any
  handler code runs. Tests cover the guard on the jobs, runs, and events routes.

### Refresh and retry (client)

`request()` sends the access token. On a 401:

1. If the token in storage is already newer than the one we sent, another request refreshed it, so we
   retry with it and don't refresh again.
2. Otherwise we call the refresh endpoint through a **single in-flight promise**. Concurrent 401s wait
   on that one call, so N simultaneous expiries cause one refresh, not N.
3. We retry the original request **exactly once**. A second 401 means the session is unrecoverable.
4. If refresh fails, we clear the tokens and dispatch a logout event. The auth provider clears the React
   Query cache and routes to `/signin`.

Login sends no token, so a wrong password is a plain 401 and never triggers a refresh or logout.

### SSE authentication

Native `EventSource` can't send headers. I used **`@microsoft/fetch-event-source`**, which the scaffold
already provides. The stream sends the same `Authorization: Bearer` header as every other request, so the
server has one auth path, and a token in the query string is ignored. A test checks that.

The library copies headers once when a stream starts, so the token is injected **per attempt** through its
`fetch` option. That way a reconnect after a refresh sends the new token.

### Live progress

- The server sends the run's **full current state** on every event (500 ms apart), not deltas. A client
  that reconnects resumes from the first event it receives.
- The stream closes after the terminal event. Its timer is cleared on terminal, on client disconnect, and
  on cancel. Tests count timers to prove it.
- The client reconnects after a transient failure, with exponential backoff capped at 8 seconds. A 401
  triggers one silent refresh (see above). A 404 stops the loop, since the run no longer exists.
- Unmount or a change of run aborts the connection and any pending retry timer. Tests verify this, and I
  confirmed the tests fail when the cleanup is removed.

### The run state machine

`computeRun` is a **pure function** of `(startedAt, sourceUrl, now)`. Nothing is stored except the start
time, so the stage, progress, and result can never disagree with each other.

| Stage | Window |
|---|---|
| QUEUED | 0–2 s |
| DOWNLOADING | 2–8 s |
| PROBING | 8–11 s |
| TRANSCODING | 11–25 s |
| PACKAGING | 25–30 s |
| COMPLETED | from 30 s |

- Internally the state is a **discriminated union** (`active`, `completed`, `failed`). A completed run
  always has a result, and a failed run always has an error.
- `progressPct` is elapsed time over total, floored, so it never reaches 100 before completion and never
  goes backwards.
- A clock that reads earlier than the start time clamps to elapsed 0.
- **Job status** is derived from the latest run when read. The stored value is only the initial `NEW`, so
  the job can't drift from its run.
- A second run is refused with **409** while the latest run is active. A failed or completed job can always
  be re-run.

## Tests

75 tests across 12 files, run with Vitest and jsdom. The strategy is to test the parts where bugs would
hurt: the state machine, token rules, the refresh and retry path, stream cleanup, and the API contract.

| Area | What's covered |
|---|---|
| State machine | Stage order, monotonic progress, completion boundary, failure freezes progress, clock skew |
| Auth | Round-trips, wrong-purpose tokens rejected, 60 s expiry, forged claims, malformed credentials, restart behaviour with and without `AUTH_SECRET`, empty-secret handling, hot-reload safety |
| Routes | Login and refresh, field errors, the guard on every protected family, 404 and 409 cases |
| Jobs and runs | Create, list, detail, validation, body size limit, active-run refusal, retry after failure, derived status, result only once complete |
| Stream (server) | Immediate first event, full run in order, timer counts on disconnect and on abort, auth required |
| Stream (client) | State updates, de-duplicated log, failed error surfaced, reconnect and resume, unmount cleanup, 401 refresh and retry with the new token |
| API client | Bearer token attached, refresh once and retry, single refresh for concurrent 401s, logout on failed refresh, one retry only, login 401 not treated as expiry |
| UI | Create form: client validation blocks the call, server field errors map onto the input, form resets on success; results view rendering |
| Validation | URL rules (scheme, path, length, trimming), title limit |

**Mutation checks.** I broke the code deliberately and confirmed the tests catch it: removing the
concurrent-refresh sharing (3 refreshes instead of 1), removing the server's abort cleanup, removing the
client's unmount cleanup, reverting the empty-secret fix, and removing the body size cap.

**Not covered by automated tests:** `AuthProvider.login()` and the route guard in the layout need a router
and provider harness, which I didn't build. I checked them by hand in a real browser: sign in, the jobs
list, create, run start, live progress, completion with results, and the failed state from the magic URL. Clicking Retry and Sign out were not checked in the browser.

## Assumptions

- **Source URLs** must be absolute http(s) links with a path, up to 2048 characters. `localhost` is allowed
  for development. A bare host like `https://cdn.example.com` is rejected.
- **Encoding is simulated.** The timeline is fixed, the source is 212 seconds, and the renditions are
  1080p, 720p, and 480p. No real media is touched.
- **Progress is overall**, not per stage.
- **Retry starts a fresh run.** The failed run stays in history as it was.
- **The demo user is the only user.** Sign-up, roles, and password reset are out of scope, as the brief says.

## Trade-offs and known limits

- **Refresh tokens are not rotated or revoked.** A stolen refresh token works until it expires, 7 days later.
  Rotation with reuse detection would fix this.
- **Tokens live in `localStorage`.** Script injection could read them. The safer choice is an HttpOnly cookie
  with CSRF protection. For this exercise I kept the scaffold's token store.
- **Any refresh failure logs the user out**, including a network error during refresh. A more careful version
  would keep the session on network errors and log out only on a 401.
- **Everything is in memory.** Restarting the server loses all jobs and runs, and memory grows without limit.
- **No login rate limiting.** The password check is constant-time, but nothing slows down guessing.
- **The active-run check is safe for one process.** The check and the insert happen with no `await` between
  them, so Node's single thread can't interleave them. Multiple server instances would need a shared store and
  an atomic check.
- **The stream reconnects from full state**, so it can't replay what happened between events. The log shows
  each stage change, not every tick.
- **npm audit reports 12 vulnerabilities** (1 critical, 7 high, 4 moderate) in the scaffold's dependencies. I
  didn't run `audit fix --force`, since it can change major versions under the app.

## Next steps (with more time)

1. Replace the simulated encode with a real worker that runs FFmpeg, with the state machine reading from
   worker progress instead of the clock.
2. Persist jobs and runs, and move tokens to HttpOnly cookies with refresh rotation and reuse detection.
3. Add login rate limiting and an audit log of runs.
4. Make the stream resumable from an event ID, using `Last-Event-ID`, so a reconnect can replay missed
   stages.
5. Add end-to-end tests for the full flow, and run the suite in CI on Node 20 and 24.
6. Resolve the npm audit findings and upgrade the affected dependencies, testing each upgrade.
