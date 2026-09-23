import { describe, expect, it } from "vitest";
import {
  KEYWORDS_PER_BUILD,
  selectKeywordsForBuild,
} from "@/server/recommendation/collect-tagged-candidates";

const DAY = 86_400;

function keywords(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `kw${i}`);
}

describe("selectKeywordsForBuild", () => {
  it("returns a short list whole (trimmed, de-duplicated)", () => {
    expect(
      selectKeywordsForBuild([" obsidian ", "", "Obsidian", "diy"], 1, 0),
    ).toEqual(["obsidian", "diy"]);
  });

  it("caps a long list to one window per build", () => {
    const picked = selectKeywordsForBuild(keywords(51), 1, 0);
    expect(picked).toHaveLength(KEYWORDS_PER_BUILD);
    expect(new Set(picked).size).toBe(KEYWORDS_PER_BUILD);
  });

  it("is stable within a day and moves to a disjoint window the next day", () => {
    const all = keywords(51);
    const morning = selectKeywordsForBuild(all, 7, 100 * DAY + 3600);
    const evening = selectKeywordsForBuild(all, 7, 100 * DAY + 20 * 3600);
    const tomorrow = selectKeywordsForBuild(all, 7, 101 * DAY + 3600);
    expect(evening).toEqual(morning);
    expect(tomorrow).not.toEqual(morning);
    expect(morning.filter((k) => tomorrow.includes(k))).toHaveLength(0);
  });

  it("cycles through every keyword within a few days", () => {
    const all = keywords(51);
    const seen = new Set<string>();
    const days = Math.ceil(51 / KEYWORDS_PER_BUILD) + 1;
    for (let d = 0; d < days; d += 1) {
      for (const k of selectKeywordsForBuild(all, 3, d * DAY)) seen.add(k);
    }
    expect(seen.size).toBe(51);
  });

  it("wraps around the end of the list instead of truncating", () => {
    // Window starts near the tail: the tail plus the head of the list.
    const all = keywords(15);
    const picked = selectKeywordsForBuild(all, 0, 1 * DAY, 12);
    expect(picked).toHaveLength(12);
    expect(new Set(picked).size).toBe(12);
  });
});
