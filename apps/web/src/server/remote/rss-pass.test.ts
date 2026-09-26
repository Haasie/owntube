import { describe, expect, it } from "vitest";
import { feedToken, sha256Hex } from "./rss-pass";

describe("feedToken", () => {
  it("is 32 lowercase hex characters derived from the password", () => {
    const t = feedToken("0123456789abcdef0123");
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(t).toBe(
      sha256Hex("owntube-feed-token:0123456789abcdef0123").slice(0, 32),
    );
  });
  it("changes when the password changes", () => {
    expect(feedToken("a".repeat(20))).not.toBe(feedToken("b".repeat(20)));
  });
});
