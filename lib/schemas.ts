import { z } from "zod";

// Schemas are shared between client (React Hook Form resolver) and server (Route Handler validation),
// so the same rules apply in both places and field errors map cleanly back to the form.

/**
 * A usable media source: an absolute http(s) URL that points at a path (not just a bare host).
 * Hostname checks are deliberately loose so `localhost` works in development.
 */
export function isMediaHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const httpOnly = url.protocol === "http:" || url.protocol === "https:";
    return httpOnly && url.hostname.length > 0 && url.pathname.length > 1;
  } catch {
    return false;
  }
}

export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Source URL is required")
  .max(2048, "Source URL is too long (2048 characters at most)")
  .refine(isMediaHttpUrl, {
    message: "Enter a full http(s) link to a media file, e.g. https://cdn.example.com/videos/clip.mp4",
  });

export const createJobSchema = z.object({
  sourceUrl: sourceUrlSchema,
  title: z
    .string()
    .trim()
    .max(80, "Keep the title under 80 characters")
    .optional()
    .or(z.literal("")),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").pipe(z.email("Enter a valid email")),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const startRunSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
});
