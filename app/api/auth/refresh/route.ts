import { issueAccessToken, verifyRefreshToken } from "@/lib/server/auth";
import { error, json, readJsonBody, validationError } from "@/lib/server/http";
import { refreshSchema } from "@/lib/schemas";

// POST { refreshToken } → { accessToken }; 401 if the refresh token is invalid or expired.
export async function POST(req: Request) {
  const parsed = refreshSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error.issues);

  const userId = verifyRefreshToken(parsed.data.refreshToken);
  if (!userId) return error(401, "Invalid or expired refresh token");

  return json({ accessToken: issueAccessToken(userId) });
}
