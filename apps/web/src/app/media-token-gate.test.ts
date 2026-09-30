import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchWithTimeout routes media fetches through undici's own fetch; alias it
// to the global one so the stub below sees every upstream request.
vi.mock("undici", () => ({
  Agent: class {},
  fetch: (...args: unknown[]) =>
    (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
}));

// Thumbnails go through a disk cache; keep it off the disk here.
vi.mock("@/server/assets/cache", () => ({
  getCachedAsset: async (
    _key: string,
    _kind: string,
    fetchUpstream: () => Promise<Response>,
  ) => {
    const r = await fetchUpstream();
    return {
      body: Buffer.from(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") ?? "",
    };
  },
}));

import { GET as captionsGET } from "@/app/captions/[videoId]/route";
import { GET as hlsGET } from "@/app/hls/[...parts]/route";
import { GET as streamGET } from "@/app/stream/[...rest]/route";
import { mediaTokensIn } from "@/lib/media-token";
import { signMediaToken } from "@/server/media/media-token";

const APP = "http://localhost:3000";
const INSTANCE = "http://invidious.test";
/** googlevideo's own `mt`, which every stream URL carries next to ours. */
const GOOGLE_MT = "mt=1727700000";
const HOUR_MS = 60 * 60 * 1000;

/** A `sidx` box indexing two 5 s fragments (see parseSidx). */
function sidxBox(): Uint8Array<ArrayBuffer> {
  const refs = [50_000, 48_000];
  const b = Buffer.alloc(32 + refs.length * 12);
  b.writeUInt32BE(b.length, 0);
  b.write("sidx", 4, "ascii");
  b.writeUInt32BE(1, 12); // reference_ID
  b.writeUInt32BE(1000, 16); // timescale
  b.writeUInt16BE(refs.length, 30);
  refs.forEach((size, i) => {
    b.writeUInt32BE(size, 32 + i * 12);
    b.writeUInt32BE(5000, 36 + i * 12);
  });
  return new Uint8Array(b);
}

function stream(itag: number, videoId: string) {
  return {
    itag,
    type:
      itag === 140
        ? 'audio/mp4; codecs="mp4a.40.2"'
        : 'video/mp4; codecs="avc1.4d401f"',
    url: `${INSTANCE}/videoplayback?itag=${itag}&${GOOGLE_MT}&dur=10.000&id=${videoId}&host=rr1---sn-abc.googlevideo.com`,
    init: "0-740",
    index: "741-800",
    bitrate: itag === 140 ? 130_000 : 1_500_000,
    ...(itag === 140 ? {} : { size: "1280x720" }),
  };
}

/** Invidious, answering the requests an HLS session makes; returns every URL asked for. */
function installUpstream(): URL[] {
  const seen: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push(url);
      const videos = /^\/api\/v1\/videos\/([\w-]+)$/.exec(url.pathname);
      if (videos?.[1]) {
        return Response.json({
          adaptiveFormats: [stream(136, videos[1]), stream(140, videos[1])],
          captions: [{ label: "English", language_code: "en" }],
        });
      }
      if (url.pathname === "/videoplayback") {
        const range = new Headers(init?.headers).get("range");
        if (range === "bytes=741-800") {
          return new Response(new Blob([sidxBox()]), { status: 206 });
        }
        return new Response(new Blob([new Uint8Array(100)]), {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": "bytes 0-99/98841",
            "content-length": "100",
          },
        });
      }
      if (url.pathname.startsWith("/api/v1/captions/")) {
        return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n", {
          headers: { "content-type": "text/vtt" },
        });
      }
      if (url.pathname.startsWith("/api/manifest/hls_variant/")) {
        return new Response(
          `#EXTM3U\n#EXTINF:5,\n${INSTANCE}/videoplayback?itag=95&sq=1&${GOOGLE_MT}\n`,
          { headers: { "content-type": "application/x-mpegurl" } },
        );
      }
      if (url.pathname.startsWith("/vi/")) {
        return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return seen;
}

/** Call whichever route serves `url`, the way the app router would. */
function get(url: URL | string, range?: string): Promise<Response> {
  const u = new URL(url, APP);
  const request = new Request(u, { headers: range ? { range } : {} });
  const [, prefix, ...parts] = u.pathname.split("/");
  if (prefix === "hls") {
    return hlsGET(request, { params: Promise.resolve({ parts }) });
  }
  if (prefix === "stream") {
    return streamGET(request, { params: Promise.resolve({ rest: parts }) });
  }
  if (prefix === "captions") {
    return captionsGET(request, {
      params: Promise.resolve({ videoId: parts[0] }),
    });
  }
  throw new Error(`no route for ${u.pathname}`);
}

/** Every URI a player would fetch from a playlist: URI="…" and URL lines. */
function references(m3u8: string): string[] {
  return m3u8
    .split("\n")
    .flatMap((line) =>
      line.startsWith("#")
        ? [...line.matchAll(/URI="([^"]+)"/g)].map((m) => m[1] as string)
        : line
          ? [line]
          : [],
    );
}

describe("media routes with MEDIA_TOKEN_REQUIRED=true", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "true");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-media-tokens");
    vi.stubEnv("INVIDIOUS_BASE_URL", INSTANCE);
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", "");
    vi.stubEnv("INVIDIOUS_PUBLIC_BASE_URL", "");
    vi.stubEnv("INVIDIOUS_DIRECT_HLS_SEGMENTS", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answers 403 without a valid token, before asking any upstream", async () => {
    const seen = installUpstream();
    const expired = signMediaToken(Date.now() - 13 * HOUR_MS);
    for (const mt of ["", `&mt=${expired}`, `&${GOOGLE_MT}`, "&mt=1.forged"]) {
      expect((await get(`/hls/tokGate01/master.m3u8?x=1${mt}`)).status).toBe(
        403,
      );
      expect(
        (await get(`/stream/videoplayback?itag=136${mt}`, "bytes=0-99")).status,
      ).toBe(403);
      expect(
        (await get(`/stream/api/v1/videos/tokGate01?x=1${mt}`)).status,
      ).toBe(403);
      expect((await get(`/captions/tokGate01?lang=en${mt}`)).status).toBe(403);
    }
    expect(seen).toEqual([]);
  });

  it("keeps thumbnails open", async () => {
    installUpstream();
    const res = await get("/stream/vi/tokGate02/hqdefault.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("carries one token from the master playlist down to segments and captions", async () => {
    const seen = installUpstream();
    const token = signMediaToken();
    const ours = (ref: string, base: URL) =>
      mediaTokensIn(new URL(ref, base).searchParams);

    const masterUrl = new URL(`/hls/tokGate03/master.m3u8?mt=${token}`, APP);
    const master = await get(masterUrl);
    expect(master.status).toBe(200);
    const masterRefs = references(await master.text());
    expect(masterRefs.length).toBeGreaterThanOrEqual(3);
    for (const ref of masterRefs) expect(ours(ref, masterUrl)).toEqual([token]);

    // A variant playlist, resolved against the master as AVPlayer does.
    const variant = masterRefs.find((r) => /^media\.m3u8\?itag=136/.test(r));
    const mediaUrl = new URL(variant as string, masterUrl);
    const media = await get(mediaUrl);
    expect(media.status).toBe(200);
    const segments = references(await media.text());
    expect(segments).toHaveLength(3); // EXT-X-MAP + two fragments
    for (const ref of segments) {
      expect(ref).toMatch(/^\/stream\/videoplayback\?/);
      expect(ref).toContain(GOOGLE_MT);
      expect(ours(ref, mediaUrl)).toEqual([token]);
    }
    const segment = await get(
      new URL(segments[1] as string, mediaUrl),
      "bytes=0-99",
    );
    expect(segment.status).toBe(206);

    // The subtitle playlist and the caption file behind it.
    const subtitles = masterRefs.find((r) => r.startsWith("subtitles.m3u8"));
    const subtitlesUrl = new URL(subtitles as string, masterUrl);
    const subtitleRefs = references(await (await get(subtitlesUrl)).text());
    expect(subtitleRefs).toHaveLength(1);
    expect(ours(subtitleRefs[0] as string, subtitlesUrl)).toEqual([token]);
    const vtt = await get(new URL(subtitleRefs[0] as string, subtitlesUrl));
    expect(vtt.status).toBe(200);
    expect(await vtt.text()).toContain("WEBVTT");

    // The token stays here; googlevideo's own mt goes through.
    const segmentFetch = seen.find(
      (u) =>
        u.pathname === "/videoplayback" && u.searchParams.get("itag") === "136",
    );
    expect(segmentFetch?.searchParams.getAll("mt")).toContain("1727700000");
    for (const url of seen) expect(url.toString()).not.toContain(token);
  });

  it("passes the token on into a proxied upstream playlist, and not upstream", async () => {
    const seen = installUpstream();
    const token = signMediaToken();
    const res = await get(
      `/stream/api/manifest/hls_variant/id/x/index.m3u8?mt=${token}`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(
      `${APP}/stream/videoplayback?itag=95&sq=1&${GOOGLE_MT}&mt=${token}`,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.pathname).toBe("/api/manifest/hls_variant/id/x/index.m3u8");
    expect(seen[0]?.toString()).not.toContain(token);
  });
});

describe("media routes with MEDIA_TOKEN_REQUIRED off", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-media-tokens");
    vi.stubEnv("INVIDIOUS_BASE_URL", INSTANCE);
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", "");
    vi.stubEnv("INVIDIOUS_PUBLIC_BASE_URL", "");
    vi.stubEnv("INVIDIOUS_DIRECT_HLS_SEGMENTS", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves every route without a token, with playlists as they always were", async () => {
    installUpstream();
    const master = await get("/hls/tokOpen01/master.m3u8");
    expect(master.status).toBe(200);
    const masterBody = await master.text();
    expect(masterBody).not.toContain("mt=");
    expect(masterBody).toContain("\nmedia.m3u8?itag=136\n");

    const media = await get("/hls/tokOpen01/media.m3u8?itag=136");
    expect(media.status).toBe(200);
    for (const ref of references(await media.text())) {
      expect(ref).toBe(
        `/stream/videoplayback?itag=136&${GOOGLE_MT}&dur=10.000&id=tokOpen01&host=rr1---sn-abc.googlevideo.com`,
      );
    }
    expect(
      (await get(`/stream/videoplayback?itag=136&${GOOGLE_MT}`, "bytes=0-99"))
        .status,
    ).toBe(206);
    expect((await get("/captions/tokOpen01?lang=en")).status).toBe(200);
  });
});
