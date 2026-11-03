import { getUserIdFromRequest } from "@/lib/server/auth";

export function json(data: unknown, init?: number | ResponseInit): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers: { "content-type": "application/json", ...(responseInit.headers ?? {}) },
  });
}

export function error(status: number, detail: string): Response {
  return json({ detail }, status);
}

/**
 * 400 response for schema failures. `fieldErrors` maps each field to its first message, so the
 * client can attach errors to the matching form field. Form-level issues go under "_form".
 */
export function validationError(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Response {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join(".") || "_form";
    fieldErrors[field] ??= issue.message;
  }
  return json({ detail: "Invalid input", fieldErrors }, 400);
}

/** Parsed JSON body, or undefined if the body isn't valid JSON (schema validation then rejects it). */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** Returns the authenticated userId, or throws a Response (401) to be caught by the handler. */
export function requireUser(req: Request): string {
  const userId = getUserIdFromRequest(req);
  if (!userId) throw error(401, "Not authenticated");
  return userId;
}

/** Wraps a handler so a thrown Response (e.g. from requireUser) becomes the actual response. */
export async function withAuth(
  req: Request,
  handler: (userId: string) => Promise<Response> | Response,
): Promise<Response> {
  try {
    const userId = requireUser(req);
    return await handler(userId);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
