import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHlsSameOriginConfig,
  proxyUrlForHlsFetch,
  resetHlsSameOriginManifestHostCache,
} from "@/lib/hls-same-origin";

const ORIGIN = "http://localhost:3000";

describe("proxyUrlForHlsFetch", () => {
  afterEach(() => {
    resetHlsSameOriginManifestHostCache();
  });
  it("rewrites googlevideo segment URLs to yt-hls", () => {
    const url =
      "https://rr1---sn-abc.googlevideo.com/videoplayback/id/x/seg.ts";
    const out = proxyUrlForHlsFetch(url, ORIGIN);
    expect(out).toBe(`${ORIGIN}/yt-hls?url=${encodeURIComponent(url)}`);
  });

  it("rewrites mis-resolved same-origin videoplayback paths via yt-hls", () => {
    const manifest =
      "https://rr1---sn-abc.googlevideo.com/api/manifest/hls/id/x/index.m3u8";
    proxyUrlForHlsFetch(
      `${ORIGIN}/yt-hls?url=${encodeURIComponent(manifest)}`,
      ORIGIN,
    );
    const out = proxyUrlForHlsFetch(
      `${ORIGIN}/videoplayback/id/abc/seg.ts`,
      ORIGIN,
    );
    expect(out).toContain("/yt-hls?url=");
    expect(decodeURIComponent(out)).toContain("rr1---sn-abc.googlevideo.com");
    expect(decodeURIComponent(out)).toContain("/videoplayback/id/abc/seg.ts");
  });

  it("rewrites Invidious manifest paths to /stream", () => {
    const url =
      "http://127.0.0.1:3001/api/manifest/hls_playlist/expire/1/id/x/index.m3u8";
    expect(proxyUrlForHlsFetch(url, ORIGIN)).toBe(
      `${ORIGIN}/stream/api/manifest/hls_playlist/expire/1/id/x/index.m3u8`,
    );
  });

  it("leaves already-proxied yt-hls URLs unchanged", () => {
    const url = `${ORIGIN}/yt-hls?url=${encodeURIComponent("https://youtube.com/x")}`;
    expect(proxyUrlForHlsFetch(url, ORIGIN)).toBe(url);
  });

  it("rewrites live chunk hostnames on c.youtube.com", () => {
    const url =
      "https://rr1---sn-25ge7nzk.c.youtube.com/videoplayback/id/x/seg.ts";
    const out = proxyUrlForHlsFetch(url, ORIGIN);
    expect(out).toContain("/yt-hls?url=");
    expect(decodeURIComponent(out)).toContain("c.youtube.com");
  });
});

describe("buildHlsSameOriginConfig", () => {
  it("disables hls.js's TimelineController so it cannot wipe sidecar caption cues", () => {
    const config = buildHlsSameOriginConfig(ORIGIN);
    // Must be an explicit own key: hls.js spreads user config over its defaults,
    // so only a present-but-undefined key removes the default controller.
    expect(Object.hasOwn(config, "timelineController")).toBe(true);
    expect(config.timelineController).toBeUndefined();
    expect(config.renderTextTracksNatively).toBe(false);
  });
});

describe("proxyUrlForHlsFetch with a media token", () => {
  const TOKEN = `1790000000.${"a".repeat(43)}`;
  const mt = `mt=${TOKEN}`;
  afterEach(() => {
    resetHlsSameOriginManifestHostCache();
    vi.unstubAllGlobals();
  });

  it("puts it on Invidious URLs it rewrites to /stream", () => {
    const url =
      "http://127.0.0.1:3001/api/manifest/hls_playlist/id/x/index.m3u8";
    expect(proxyUrlForHlsFetch(url, ORIGIN, TOKEN)).toBe(
      `${ORIGIN}/stream/api/manifest/hls_playlist/id/x/index.m3u8?${mt}`,
    );
  });

  it("adds it to a /stream URL that arrived without one, keeping googlevideo's mt", () => {
    expect(
      proxyUrlForHlsFetch(
        `${ORIGIN}/stream/videoplayback?itag=136&mt=1727700000`,
        ORIGIN,
        TOKEN,
      ),
    ).toBe(`${ORIGIN}/stream/videoplayback?itag=136&mt=1727700000&${mt}`);
  });

  it("leaves a /stream URL that already has one, and the /yt-hls hop, alone", () => {
    const older = `1780000000.${"b".repeat(43)}`;
    const tokened = `${ORIGIN}/stream/videoplayback?itag=136&mt=${older}`;
    expect(proxyUrlForHlsFetch(tokened, ORIGIN, TOKEN)).toBe(tokened);
    const hop = `${ORIGIN}/yt-hls?url=${encodeURIComponent("https://youtube.com/x")}`;
    expect(proxyUrlForHlsFetch(hop, ORIGIN, TOKEN)).toBe(hop);
  });

  it("reads the page's token when none is passed", () => {
    vi.stubGlobal("window", { __owntubeMediaToken: TOKEN });
    expect(
      proxyUrlForHlsFetch(`${ORIGIN}/stream/videoplayback?itag=136`, ORIGIN),
    ).toBe(`${ORIGIN}/stream/videoplayback?itag=136&${mt}`);
  });
});
