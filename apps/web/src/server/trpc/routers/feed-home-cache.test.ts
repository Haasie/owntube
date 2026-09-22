import { afterEach, describe, expect, it, vi } from "vitest";
import { users, videoCache } from "@/server/db/schema";
import * as engine from "@/server/recommendation/engine";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("feed.home materialized stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers from an expired row while it recomputes in the background", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "home@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();
    db.insert(videoCache)
      .values({
        cacheKey: `home-feed:v1:${user.id}:US:1`,
        source: "invidious",
        kind: "home",
        payloadJson: JSON.stringify([
          { videoId: "abcdefghijk", title: "Cached pick" },
        ]),
        fetchedAt: now - 1200,
        expiresAt: now - 600,
      })
      .run();
    // The recompute never finishes; the answer must not wait for it.
    const recompute = vi
      .spyOn(engine, "getPersonalizedFeedVideos")
      .mockReturnValue(new Promise(() => {}));

    const caller = appRouter.createCaller({ db, userId: user.id });
    const page = await caller.feed.home({ region: "US", pageSize: 24 });

    expect(page.videos.map((v) => v.videoId)).toEqual(["abcdefghijk"]);
    expect(recompute).toHaveBeenCalledTimes(1);

    // A second load joins the running refresh instead of starting another.
    await caller.feed.home({ region: "US", pageSize: 24 });
    expect(recompute).toHaveBeenCalledTimes(1);
    sqlite.close();
  });
});
