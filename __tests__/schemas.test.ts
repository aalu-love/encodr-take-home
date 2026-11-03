import { describe, expect, it } from "vitest";
import { createJobSchema, isMediaHttpUrl, sourceUrlSchema } from "@/lib/schemas";

describe("source URL validation", () => {
  it.each([
    "https://cdn.example.com/videos/clip.mp4",
    "http://localhost:8080/media/sample.mov",
  ])("accepts a full http(s) media link: %s", (url) => {
    expect(sourceUrlSchema.safeParse(url).success).toBe(true);
    expect(isMediaHttpUrl(url)).toBe(true);
  });

  it.each([
    ["not a url", "not a url"],
    ["an ftp link", "ftp://cdn.example.com/videos/clip.mp4"],
    ["a bare host with no path", "https://cdn.example.com"],
    ["a host with only a slash", "https://cdn.example.com/"],
  ])("rejects %s", (_label, url) => {
    const result = sourceUrlSchema.safeParse(url);
    expect(result.success).toBe(false);
  });

  it("rejects a URL longer than 2048 characters, even if it is otherwise valid", () => {
    const long = `https://cdn.example.com/${"a".repeat(2100)}.mp4`;
    const result = sourceUrlSchema.safeParse(long);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/too long/);
  });

  it("reports 'Source URL is required' for an empty value, and trims whitespace before checking", () => {
    const empty = sourceUrlSchema.safeParse("   ");
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("Source URL is required");

    const padded = sourceUrlSchema.safeParse("  https://cdn.example.com/videos/clip.mp4  ");
    expect(padded.success).toBe(true);
    expect(padded.data).toBe("https://cdn.example.com/videos/clip.mp4");
  });

  it("makes the title optional and rejects one over 80 characters", () => {
    const ok = createJobSchema.safeParse({ sourceUrl: "https://cdn.example.com/a/b.mp4" });
    expect(ok.success).toBe(true);

    const tooLong = createJobSchema.safeParse({
      sourceUrl: "https://cdn.example.com/a/b.mp4",
      title: "x".repeat(81),
    });
    expect(tooLong.success).toBe(false);
  });
});
