import { authenticate, issueTokens } from "@/lib/server/auth";
import { error, json, readJsonBody, validationError } from "@/lib/server/http";
import { loginSchema } from "@/lib/schemas";

// POST { email, password } → { accessToken, refreshToken, user }; 401 on bad credentials.
export async function POST(req: Request) {
  const parsed = loginSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error.issues);

  const user = authenticate(parsed.data.email, parsed.data.password);
  if (!user) return error(401, "Invalid email or password");

  return json({ ...issueTokens(user.id), user });
}
