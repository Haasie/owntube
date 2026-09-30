import { describe, expect, it } from "vitest";
import {
  isMediaTokenGatedPath,
  mediaTokenExpiry,
  withMediaToken,
  withMediaTokenIfGated,
  withoutMediaToken,
} from "@/lib/media-token";

const TOKEN = `1790000000.${"a".repeat(43)}`;
const ORIGIN = "https://youtube.example";

describe("withMediaToken", () => {
  it("adds mt to a URL with or without a query", () => {
    expect(withMediaToken("/hls/abc/master.m3u8", TOKEN)).toBe(
      `/hls/abc/master.m3u8?mt=${TOKEN}`,
    );
    expect(withMediaToken("media.m3u8?itag=137", TOKEN)).toBe(
      `media.m3u8?itag=137&mt=${TOKEN}`,
    );
  });

  it("replaces an older token but keeps googlevideo's own mt", () => {
    const older = `1780000000.${"b".repeat(43)}`;
    expect(
      withMediaToken(
        `/stream/videoplayback?itag=137&mt=1727700000&mt=${older}`,
        TOKEN,
      ),
    ).toBe(`/stream/videoplayback?itag=137&mt=1727700000&mt=${TOKEN}`);
  });

  it("leaves a signed query's encoding alone and keeps the hash last", () => {
    expect(withMediaToken("/stream/x?sig=AB%2Fcd%3D%3D&b=1#t=5", TOKEN)).toBe(
      `/stream/x?sig=AB%2Fcd%3D%3D&b=1&mt=${TOKEN}#t=5`,
    );
  });

  it("changes nothing without a token", () => {
    expect(withMediaToken("/stream/x?a=1", null)).toBe("/stream/x?a=1");
    expect(withMediaToken("/stream/x?a=1", undefined)).toBe("/stream/x?a=1");
  });
});

describe("withMediaTokenIfGated", () => {
  it("tags only /hls, /stream and /captions on our own origin", () => {
    expect(
      withMediaTokenIfGated(`${ORIGIN}/hls/abc/master.m3u8`, TOKEN, ORIGIN),
    ).toBe(`${ORIGIN}/hls/abc/master.m3u8?mt=${TOKEN}`);
    expect(withMediaTokenIfGated(`${ORIGIN}/yt-hls?url=x`, TOKEN, ORIGIN)).toBe(
      `${ORIGIN}/yt-hls?url=x`,
    );
    expect(
      withMediaTokenIfGated(
        "https://invidious.example/stream/videoplayback?a=1",
        TOKEN,
        ORIGIN,
      ),
    ).toBe("https://invidious.example/stream/videoplayback?a=1");
  });

  it("resolves a relative reference against the base it is given", () => {
    expect(
      withMediaTokenIfGated("seg-1.ts", TOKEN, ORIGIN, `${ORIGIN}/stream/`),
    ).toBe(`seg-1.ts?mt=${TOKEN}`);
    expect(withMediaTokenIfGated("seg-1.ts", TOKEN, ORIGIN)).toBe("seg-1.ts");
  });
});

describe("withoutMediaToken", () => {
  it("drops our token and keeps googlevideo's mt in place", () => {
    const params = new URLSearchParams(
      `itag=137&mt=1727700000&host=x&mt=${TOKEN}`,
    );
    expect(withoutMediaToken(params).toString()).toBe(
      "itag=137&mt=1727700000&host=x",
    );
  });
});

describe("helpers", () => {
  it("knows which paths are gated", () => {
    expect(isMediaTokenGatedPath("/hls/abc/master.m3u8")).toBe(true);
    expect(isMediaTokenGatedPath("/stream/videoplayback")).toBe(true);
    expect(isMediaTokenGatedPath("/captions/abc")).toBe(true);
    expect(isMediaTokenGatedPath("/dash/abc/manifest.mpd")).toBe(false);
    expect(isMediaTokenGatedPath("/yt-hls")).toBe(false);
  });

  it("reads the expiry off a token", () => {
    expect(mediaTokenExpiry(TOKEN)).toBe(1790000000);
    expect(mediaTokenExpiry("garbage")).toBeNull();
  });
});
