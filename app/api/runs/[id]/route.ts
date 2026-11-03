import { error, json, withAuth } from "@/lib/server/http";
import { getRun } from "@/lib/server/store";

// GET → EncodeRun; 404 if no run has that id.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await ctx.params;
    const run = getRun(id);
    return run ? json(run) : error(404, "Run not found");
  });
}
