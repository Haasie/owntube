import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googlevideoUrlFromInvidiousVideoplaybackReference,
  isYoutubeFamilyHostname,
  rewriteHlsPlaylistMediaUrls,
  rewriteInvidiousVideoplaybackLinesToYtHls,
  rewriteM3u8AllProxies,
  rewriteM3u8ForOwnTubeProxy,
  shouldUseInvidiousProxyForUrl,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectPoster,
  toProxiedOrDirectVariants,
  toStreamProxyUrl,
} from "@/lib/invidious-proxy";

describe("shouldUseInvidiousProxyForUrl", () => {
  it("matches newer Invidious HLS under /api/manifest/ (not only /api/v1/)", () => {
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";
    const url =
      "http://127.0.0.1:3001/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8";
    expect(shouldUseInvidiousProxyForUrl(url)).toBe(true);
    expect(toProxiedOrDirectPlayback(url, "http://localhost:3000", "")).toBe(
      "http://localhost:3000/stream/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8",
    );
  });
});

describe("toStreamProxyUrl", () => {
  const app = "https://owntube.test";

  it("carries a googlevideo hostname as host= so either upstream can fetch it", () => {
    expect(
      toStreamProxyUrl(
        "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&c=WEB&sig=a%2Cb",
        app,
      ),
    ).toBe(
      "https://owntube.test/stream/videoplayback?expire=1&c=WEB&sig=a%2Cb&host=rr3---sn-abc.googlevideo.com",
    );
  });

  it("keeps a host= the URL already names", () => {
    expect(
      toStreamProxyUrl(
        "https://rr3---sn-abc.googlevideo.com/videoplayback?host=rr1---sn-xyz.googlevideo.com&c=WEB",
        app,
      ),
    ).toBe(
      "https://owntube.test/stream/videoplayback?host=rr1---sn-xyz.googlevideo.com&c=WEB",
    );
  });

  it("leaves instance-hosted and non-videoplayback URLs as they were", () => {
    expect(
      toStreamProxyUrl(
        "https://invidious.test/videoplayback?c=WEB&host=rr3---sn-abc.googlevideo.com",
        app,
      ),
    ).toBe(
      "https://owntube.test/stream/videoplayback?c=WEB&host=rr3---sn-abc.googlevideo.com",
    );
    expect(toStreamProxyUrl("https://invidious.test/vi/x/hq.jpg", app)).toBe(
      "https://owntube.test/stream/vi/x/hq.jpg",
    );
  });
});

describe("isYoutubeFamilyHostname", () => {
  it("includes googlevideo and c.youtube.com chunk hosts", () => {
    expect(isYoutubeFamilyHostname("rr1---sn-abc.googlevideo.com")).toBe(true);
    expect(isYoutubeFamilyHostname("rr1---sn-abc.c.youtube.com")).toBe(true);
    expect(isYoutubeFamilyHostname("www.youtube.com")).toBe(true);
    expect(isYoutubeFamilyHostname("example.com")).toBe(false);
  });
});

describe("rewriteHlsPlaylistMediaUrls", () => {
  it("rewrites relative googlevideo segment lines to yt-hls hop", () => {
    const manifest =
      "https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1/id/x/index.m3u8";
    const body = `#EXTM3U
#EXTINF:5.0,
/videoplayback/id/abc/seg.ts`;
    const out = rewriteHlsPlaylistMediaUrls(
      body,
      "http://localhost:3000",
      manifest,
    );
    expect(out).toContain("http://localhost:3000/yt-hls?url=");
    expect(out).toContain(encodeURIComponent("/videoplayback/id/abc/seg.ts"));
    expect(out).not.toMatch(/^\/videoplayback/m);
  });

  it("rewrites c.youtube.com segment lines to yt-hls", () => {
    const manifest =
      "https://www.youtube.com/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8";
    const body = `#EXTINF:2.0,
https://rr1---sn-25ge7nzk.c.youtube.com/videoplayback/id/x/seg.ts`;
    const out = rewriteHlsPlaylistMediaUrls(
      body,
      "http://localhost:3000",
      manifest,
    );
    expect(out).toContain("/yt-hls?url=");
    expect(out).not.toContain("https://rr1---sn-25ge7nzk.c.youtube.com");
  });

  it("rewrites URI attributes in tags", () => {
    const manifest =
      "https://rr1---sn-abc.googlevideo.com/videoplayback/id/x/master.m3u8";
    const body =
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://rr1---sn-abc.googlevideo.com/videoplayback/id/x/audio.ts"';
    const out = rewriteHlsPlaylistMediaUrls(
      body,
      "http://localhost:3000",
      manifest,
    );
    expect(out).toContain("http://localhost:3000/yt-hls?url=");
  });
});

describe("rewriteM3u8AllProxies", () => {
  it("resolves relative segments when manifestUrl is provided", () => {
    const manifest =
      "https://manifest.googlevideo.com/api/manifest/hls/id/xyz/master.m3u8";
    const body = `#EXTM3U
https://manifest.googlevideo.com/api/manifest/hls/id/xyz/playlist/index.m3u8
#EXTINF:4,
/videoplayback/seg/file.ts`;
    const out = rewriteM3u8AllProxies(
      body,
      "http://localhost:3000",
      "localhost:3000",
      "",
      manifest,
    );
    expect(out).toContain("/yt-hls?url=");
    expect(out).not.toMatch(/\n\/videoplayback/);
  });
});

describe("rewriteInvidiousVideoplaybackLinesToYtHls", () => {
  it("rewrites Invidious local videoplayback segment lines to yt-hls", () => {
    const body = `#EXTINF:5.0,
http://localhost:3000/stream/videoplayback?id=x&itag=91&host=rr1---sn-abc.c.youtube.com&file=seg.ts&expire=1`;
    const out = rewriteInvidiousVideoplaybackLinesToYtHls(
      body,
      "http://localhost:3000",
    );
    expect(out).toContain("http://localhost:3000/yt-hls?url=");
    expect(out).not.toContain("/stream/videoplayback");
    expect(
      googlevideoUrlFromInvidiousVideoplaybackReference(
        "http://:3210/videoplayback?id=x&host=rr1---sn-abc.c.youtube.com&file=seg.ts",
      ),
    ).toBe("https://rr1---sn-abc.c.youtube.com/videoplayback?id=x&file=seg.ts");
  });
});

describe("rewriteM3u8ForOwnTubeProxy", () => {
  it("rewrites Invidious videoplayback segment URLs with missing hostname", () => {
    const body = `#EXTINF:5.0,
http://:3210/videoplayback?id=x&file=seg.ts`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://localhost:3000",
        "localhost:3000",
        "http://192.168.1.11:3210",
      ),
    ).toContain("http://localhost:3000/stream/videoplayback?id=x&file=seg.ts");
  });

  it("rewrites Invidious local=true URLs with missing hostname", () => {
    const body = `#EXTM3U
http://:3210/api/manifest/hls_playlist/id/x/playlist/index.m3u8?local=true`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://localhost:3000",
        "localhost:3000",
        "http://192.168.1.11:3210",
      ),
    ).toContain(
      "http://localhost:3000/stream/api/manifest/hls_playlist/id/x/playlist/index.m3u8?local=true",
    );
  });

  it("replaces 127.0.0.1 invidious origin with the proxy path", () => {
    const body = `#EXTM3U
http://127.0.0.1:3001/api/v1/segment/abc`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://192.168.1.14:3000",
        "192.168.1.14:3000",
        "http://127.0.0.1:3001",
      ),
    ).toContain("http://192.168.1.14:3000/stream/api/v1/segment/abc");
  });
});

describe("media token on browser-facing URLs", () => {
  const app = "https://owntube.test";
  const TOKEN = `1790000000.${"a".repeat(43)}`;
  const mt = `mt=${TOKEN}`;
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("goes on /stream and our own /hls, not on /yt-hls or anyone else's URL", () => {
    vi.stubEnv("INVIDIOUS_BASE_URL", "http://invidious.test");
    const play = (url: string) =>
      toProxiedOrDirectPlayback(url, app, "", TOKEN);
    expect(
      play("http://invidious.test/videoplayback?itag=18&mt=1727700000"),
    ).toBe(`${app}/stream/videoplayback?itag=18&mt=1727700000&${mt}`);
    expect(play("/hls/dQw4w9WgXcQ/master.m3u8")).toBe(
      `${app}/hls/dQw4w9WgXcQ/master.m3u8?${mt}`,
    );
    const hop = play("https://manifest.googlevideo.com/hls_live/x/index.m3u8");
    expect(hop).toContain("/yt-hls?url=");
    expect(hop).not.toContain(TOKEN);
    expect(play("https://cdn.example/live/index.m3u8")).toBe(
      "https://cdn.example/live/index.m3u8",
    );
  });

  it("goes on every source of a variant list", () => {
    vi.stubEnv("INVIDIOUS_BASE_URL", "http://invidious.test");
    const [muxed, split] = toProxiedOrDirectVariants(
      [
        {
          t: "muxed",
          label: "360p",
          url: "http://invidious.test/videoplayback?itag=18",
        },
        {
          t: "split",
          label: "1080p",
          videoUrl: "http://invidious.test/videoplayback?itag=137",
          audioUrl: "http://invidious.test/videoplayback?itag=140",
          audioOptions: [
            {
              label: "English",
              url: "http://invidious.test/videoplayback?itag=140",
            },
          ],
        },
      ],
      app,
      "",
      TOKEN,
    );
    expect(muxed?.t === "muxed" && muxed.src).toContain(mt);
    if (split?.t !== "split") throw new Error("expected a split variant");
    for (const src of [split.video, split.audio, split.audioTracks[0]?.src]) {
      expect(src).toContain(mt);
    }
  });

  it("stays off posters, which are images", () => {
    vi.stubEnv("INVIDIOUS_BASE_URL", "http://invidious.test");
    vi.stubGlobal("window", { __owntubeMediaToken: TOKEN });
    expect(
      toProxiedOrDirectPoster(
        "http://invidious.test/vi/abc/maxres.jpg",
        app,
        "",
      ),
    ).toBe(`${app}/stream/vi/abc/maxres.jpg`);
  });

  it("defaults to the page's token in the browser, and to none on the server", () => {
    const url = "http://invidious.test/videoplayback?itag=18";
    expect(toStreamProxyUrl(url, app)).toBe(
      `${app}/stream/videoplayback?itag=18`,
    );
    vi.stubGlobal("window", { __owntubeMediaToken: TOKEN });
    expect(toStreamProxyUrl(url, app)).toBe(
      `${app}/stream/videoplayback?itag=18&${mt}`,
    );
  });

  it("goes on every /stream reference of a rewritten upstream playlist", () => {
    const inv = "http://invidious.test";
    const manifest = `${inv}/api/manifest/hls_variant/id/x/index.m3u8`;
    const body = [
      "#EXTM3U",
      `#EXT-X-MAP:URI="${inv}/videoplayback?itag=136&sq=0"`,
      "#EXTINF:5,",
      `${inv}/videoplayback?itag=136&sq=1&mt=1727700000`,
      "#EXTINF:5,",
      "https://rr1---sn-abc.googlevideo.com/videoplayback/sq/2/file.ts",
    ].join("\n");
    const out = rewriteM3u8AllProxies(
      body,
      app,
      "owntube.test",
      inv,
      manifest,
      TOKEN,
    );
    expect(out).toContain(
      `#EXT-X-MAP:URI="${app}/stream/videoplayback?itag=136&sq=0&${mt}"`,
    );
    expect(out).toContain(
      `\n${app}/stream/videoplayback?itag=136&sq=1&mt=1727700000&${mt}\n`,
    );
    const hop = out.split("\n").at(-1) ?? "";
    expect(hop).toContain("/yt-hls?url=");
    expect(hop).not.toContain(TOKEN);
    expect(
      rewriteM3u8AllProxies(body, app, "owntube.test", inv, manifest),
    ).not.toContain(TOKEN);
  });
});
