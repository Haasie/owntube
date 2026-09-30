import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchWithTimeout routes media fetches through undici's own fetch; alias it
// to the global one so the stub below sees every upstream request.
vi.mock("undici", () => ({
  Agent: class {},
  fetch: (...args: unknown[]) =>
    (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
}));

import { GET } from "@/app/stream/[...rest]/route";
import {
  MEDIA_CHUNK_BYTES,
  videoplaybackUpstreamUrls,
} from "@/server/media/upstream-proxy";

const INSTANCE = "http://invidious.test";
const COMPANION = "http://companion.test:8282";
const SEARCH =
  "?expire=9999999999&c=WEB&itag=137&clen=4096&host=rr3---sn-abc.googlevideo.com";

type Seen = { origin: string; path: string; range: string | null };

/**
 * Upstreams serving `file` with 206 Range semantics; `companionStatus` makes
 * the companion answer every request with that error status instead.
 */
function installUpstreams(
  file: Uint8Array<ArrayBuffer>,
  companionStatus?: number,
) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      const range = new Headers(init?.headers).get("range");
      seen.push({ origin: url.origin, path: url.pathname, range });
      if (url.origin === COMPANION && companionStatus) {
        return new Response("refused", { status: companionStatus });
      }
      const m = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
      if (!m?.[1]) {
        return new Response(new Blob([file]), { status: 200 });
      }
      const start = Number(m[1]);
      const end = Math.min(
        m[2] ? Number(m[2]) : file.length - 1,
        file.length - 1,
      );
      return new Response(new Blob([file.slice(start, end + 1)]), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": `bytes ${start}-${end}/${file.length}`,
          "content-length": String(end - start + 1),
        },
      });
    }),
  );
  return seen;
}

function streamRequest(search: string, range: string): Request {
  return new Request(`http://localhost:3000/stream/videoplayback${search}`, {
    headers: { range },
  });
}

const routeContext = { params: Promise.resolve({ rest: ["videoplayback"] }) };

describe("videoplaybackUpstreamUrls", () => {
  beforeEach(() => {
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", COMPANION);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("puts the companion first, the instance second, by default", () => {
    vi.stubEnv("INVIDIOUS_STREAM_VIA_COMPANION", undefined);
    expect(
      videoplaybackUpstreamUrls(INSTANCE, "videoplayback", SEARCH).map(String),
    ).toEqual([
      `${COMPANION}/companion/videoplayback${SEARCH}`,
      `${INSTANCE}/videoplayback${SEARCH}`,
    ]);
  });

  it("stays on the instance when INVIDIOUS_STREAM_VIA_COMPANION=false", () => {
    vi.stubEnv("INVIDIOUS_STREAM_VIA_COMPANION", "false");
    expect(
      videoplaybackUpstreamUrls(INSTANCE, "videoplayback", SEARCH).map(String),
    ).toEqual([`${INSTANCE}/videoplayback${SEARCH}`]);
  });

  it("never falls back to the public companion path", () => {
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", undefined);
    vi.stubEnv("INVIDIOUS_PUBLIC_BASE_URL", "https://invidious.example");
    expect(
      videoplaybackUpstreamUrls(INSTANCE, "videoplayback", SEARCH).map(String),
    ).toEqual([`${INSTANCE}/videoplayback${SEARCH}`]);
  });

  it("skips the companion without host= or clen=, and for other paths", () => {
    expect(
      videoplaybackUpstreamUrls(
        INSTANCE,
        "videoplayback",
        "?c=WEB&clen=1&mn=sn-abc",
      ),
    ).toHaveLength(1);
    expect(
      videoplaybackUpstreamUrls(
        INSTANCE,
        "videoplayback",
        "?c=WEB&itag=18&host=rr3---sn-abc.googlevideo.com",
      ),
    ).toHaveLength(1);
    expect(
      videoplaybackUpstreamUrls(INSTANCE, "vi/abc/hqdefault.jpg", ""),
    ).toHaveLength(1);
  });
});

describe("/stream videoplayback via the companion", () => {
  beforeEach(() => {
    vi.stubEnv("INVIDIOUS_BASE_URL", INSTANCE);
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", COMPANION);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves a small range from the companion", async () => {
    const file = new Uint8Array(4096).map((_, i) => i % 251);
    const seen = installUpstreams(file);

    const res = await GET(
      streamRequest(SEARCH, "bytes=100-1123"),
      routeContext,
    );
    expect(res.status).toBe(206);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(
      Buffer.compare(Buffer.from(body), Buffer.from(file.slice(100, 1124))),
    ).toBe(0);
    expect(seen).toEqual([
      {
        origin: COMPANION,
        path: "/companion/videoplayback",
        range: "bytes=100-1123",
      },
    ]);
  });

  it("falls back to the instance when the companion refuses, and stays there", async () => {
    const size = Math.floor(MEDIA_CHUNK_BYTES * 2.5);
    const file = new Uint8Array(size).map((_, i) => i % 251);
    const seen = installUpstreams(file, 500);

    const res = await GET(
      streamRequest(SEARCH, `bytes=0-${size - 1}`),
      routeContext,
    );
    expect(res.status).toBe(206);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(size);
    expect(Buffer.compare(Buffer.from(body), Buffer.from(file))).toBe(0);
    // One refused companion attempt, then every chunk from the instance.
    expect(seen.map((s) => s.origin)).toEqual([
      COMPANION,
      INSTANCE,
      INSTANCE,
      INSTANCE,
    ]);
  });
});
