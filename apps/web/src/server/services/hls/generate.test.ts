import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AdaptiveFormat,
  audioXtagsOf,
  buildMasterPlaylist,
  buildMediaPlaylist,
  buildSubtitlePlaylist,
  pickAudioTracks,
  serverSideInstanceUrl,
} from "@/server/services/hls/generate";

const avc720: AdaptiveFormat = {
  itag: 136,
  type: 'video/mp4; codecs="avc1.4d401f"',
  url: "https://inv.example/videoplayback?itag=136&dur=562.433",
  init: "0-740",
  index: "741-2091",
  bitrate: 1_500_000,
  size: "1280x720",
};

const aacPlain: AdaptiveFormat = {
  itag: 140,
  type: 'audio/mp4; codecs="mp4a.40.2"',
  url: "https://inv.example/videoplayback?itag=140&dur=562.433",
  init: "0-722",
  index: "723-1438",
  bitrate: 130_000,
};

const xt = (v: string) => encodeURIComponent(v);
const dubEn: AdaptiveFormat = {
  ...aacPlain,
  bitrate: 130_895,
  url: `https://inv.example/videoplayback?itag=140&dur=562.433&xtags=${xt("acont=dubbed-auto:lang=en-US")}`,
};
const originalNlDrc: AdaptiveFormat = {
  ...aacPlain,
  bitrate: 130_946,
  url: `https://inv.example/videoplayback?itag=140&dur=562.433&xtags=${xt("acont=original:drc=1:lang=nl-NL")}`,
};
const originalNl: AdaptiveFormat = {
  ...aacPlain,
  bitrate: 130_950,
  url: `https://inv.example/videoplayback?itag=140&dur=562.433&xtags=${xt("acont=original:lang=nl-NL")}`,
};

describe("audioXtagsOf", () => {
  it("parses lang, acont and drc from the xtags parameter", () => {
    expect(audioXtagsOf(originalNlDrc.url)).toEqual({
      raw: "acont=original:drc=1:lang=nl-NL",
      lang: "nl-NL",
      acont: "original",
      drc: true,
    });
  });

  it("returns nulls when there is no xtags", () => {
    expect(audioXtagsOf(aacPlain.url)).toEqual({
      raw: null,
      lang: null,
      acont: null,
      drc: false,
    });
  });
});

describe("pickAudioTracks", () => {
  it("collapses a single-language video to one default track", () => {
    const tracks = pickAudioTracks([aacPlain, { ...aacPlain, bitrate: 1 }]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.isDefault).toBe(true);
    expect(tracks[0]?.isOriginal).toBe(true);
    expect(tracks[0]?.lang).toBeNull();
  });

  it("orders the original before dubs even when upstream lists dubs first", () => {
    const tracks = pickAudioTracks([dubEn, originalNlDrc, originalNl]);
    expect(tracks.map((t) => t.lang)).toEqual(["nl-NL", "en-US"]);
    expect(tracks[0]?.isDefault).toBe(true);
    // The non-drc row wins within the original group.
    expect(tracks[0]?.xtags).toBe("acont=original:lang=nl-NL");
  });
});

describe("buildMasterPlaylist", () => {
  it("keeps the legacy single-audio rendition shape", () => {
    const m3u8 = buildMasterPlaylist([avc720], pickAudioTracks([aacPlain]));
    expect(m3u8).toContain(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="media.m3u8?itag=140"',
    );
  });

  it("lists one rendition per language with the original as DEFAULT", () => {
    const m3u8 = buildMasterPlaylist(
      [avc720],
      pickAudioTracks([dubEn, originalNlDrc, originalNl]),
    );
    expect(m3u8).toContain(
      `NAME="Dutch (Original)",LANGUAGE="nl-NL",DEFAULT=YES,AUTOSELECT=YES,URI="media.m3u8?itag=140&xtags=${xt("acont=original:lang=nl-NL")}"`,
    );
    expect(m3u8).toContain(
      `NAME="English",LANGUAGE="en-US",DEFAULT=NO,AUTOSELECT=NO,URI="media.m3u8?itag=140&xtags=${xt("acont=dubbed-auto:lang=en-US")}"`,
    );
    // Variant rows still reference the shared audio group.
    expect(m3u8).toContain('AUDIO="aud"');
  });
});

describe("subtitles in the master playlist", () => {
  it("adds one SUBTITLES rendition per caption and links the variants to it", () => {
    const m3u8 = buildMasterPlaylist([avc720], pickAudioTracks([aacPlain]), [
      { label: "Dutch (auto-generated)", language_code: "nl" },
      { label: "Commentary" },
    ]);
    expect(m3u8).toContain(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Dutch (auto-generated)",LANGUAGE="nl",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles.m3u8?lang=nl"',
    );
    expect(m3u8).toContain(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Commentary",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles.m3u8?label=Commentary"',
    );
    expect(m3u8).toContain('AUDIO="aud",SUBTITLES="subs"');
  });

  it("leaves the variants alone when there are no captions", () => {
    const m3u8 = buildMasterPlaylist([avc720], pickAudioTracks([aacPlain]), [
      {},
    ]);
    expect(m3u8).not.toContain("SUBTITLES");
  });

  it("keeps quotes out of the rendition name", () => {
    const m3u8 = buildMasterPlaylist([avc720], pickAudioTracks([aacPlain]), [
      { label: 'The "director" cut', languageCode: "en" },
    ]);
    expect(m3u8).toContain('NAME="The director cut"');
  });
});

describe("buildSubtitlePlaylist", () => {
  it("serves the whole caption file as one segment spanning the video", () => {
    expect(buildSubtitlePlaylist("abc_DEF-123", "lang=nl", 562.433)).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:563",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXTINF:562.433,",
        "/captions/abc_DEF-123?lang=nl",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    );
  });
});

describe("serverSideInstanceUrl", () => {
  it("routes public-instance stream URLs to the internal instance", () => {
    const prevPub = process.env.INVIDIOUS_PUBLIC_BASE_URL;
    const prevInv = process.env.INVIDIOUS_BASE_URL;
    process.env.INVIDIOUS_PUBLIC_BASE_URL = "https://inv.example";
    process.env.INVIDIOUS_BASE_URL = "http://invidious:3000";
    try {
      expect(
        serverSideInstanceUrl("https://inv.example/videoplayback?itag=136&x=1"),
      ).toBe("http://invidious:3000/videoplayback?itag=136&x=1");
      // Other hosts (googlevideo, companion) pass through untouched.
      expect(
        serverSideInstanceUrl("https://rr1.googlevideo.com/videoplayback?a=1"),
      ).toBe("https://rr1.googlevideo.com/videoplayback?a=1");
    } finally {
      if (prevPub === undefined) delete process.env.INVIDIOUS_PUBLIC_BASE_URL;
      else process.env.INVIDIOUS_PUBLIC_BASE_URL = prevPub;
      if (prevInv === undefined) delete process.env.INVIDIOUS_BASE_URL;
      else process.env.INVIDIOUS_BASE_URL = prevInv;
    }
  });
});

describe("media token in the playlists", () => {
  const TOKEN = `1790000000.${"a".repeat(43)}`;
  const mt = `mt=${TOKEN}`;
  /** Every URI a player would fetch: URI="…" attributes and URL lines. */
  const references = (m3u8: string) =>
    m3u8
      .split("\n")
      .flatMap((line) =>
        line.startsWith("#")
          ? [...line.matchAll(/URI="([^"]+)"/g)].map((m) => m[1] as string)
          : line
            ? [line]
            : [],
      );
  const sidx = {
    timescale: 1000,
    mediaStart: 2092,
    refs: [
      { size: 50_000, duration: 5 },
      { size: 48_000, duration: 5 },
    ],
  };
  afterEach(() => vi.unstubAllEnvs());

  it("puts it on every child playlist the master lists", () => {
    const m3u8 = buildMasterPlaylist(
      [avc720],
      pickAudioTracks([dubEn, originalNl]),
      [{ label: "English", language_code: "en" }],
      TOKEN,
    );
    const refs = references(m3u8);
    expect(refs).toHaveLength(4); // two audio, one subtitle, one variant
    for (const ref of refs) expect(ref).toContain(mt);
    expect(m3u8).toContain(`URI="subtitles.m3u8?lang=en&${mt}"`);
    expect(m3u8).toContain(`\nmedia.m3u8?itag=136&${mt}\n`);
  });

  it("puts it on the init segment and every fragment of a media playlist", () => {
    const m3u8 = buildMediaPlaylist(avc720, sidx, TOKEN);
    const refs = references(m3u8);
    expect(refs).toHaveLength(3); // EXT-X-MAP + two fragments
    for (const ref of refs) {
      expect(ref).toBe(`/stream/videoplayback?itag=136&dur=562.433&${mt}`);
    }
  });

  it("keeps googlevideo's own mt next to ours on segment URIs", () => {
    const withGoogleMt = {
      ...avc720,
      url: "https://inv.example/videoplayback?itag=136&mt=1727700000&dur=562.433",
    };
    expect(references(buildMediaPlaylist(withGoogleMt, sidx, TOKEN))[0]).toBe(
      `/stream/videoplayback?itag=136&mt=1727700000&dur=562.433&${mt}`,
    );
  });

  it("puts it on the caption file a subtitle playlist points at", () => {
    expect(
      references(buildSubtitlePlaylist("abc_DEF-123", "lang=nl", 60, TOKEN)),
    ).toEqual([`/captions/abc_DEF-123?lang=nl&${mt}`]);
  });

  it("never hands it to a companion URL (direct segment mode)", () => {
    vi.stubEnv("INVIDIOUS_DIRECT_HLS_SEGMENTS", "true");
    const m3u8 = buildMediaPlaylist(
      {
        ...avc720,
        url: "https://inv.example/videoplayback?itag=136&host=rr1---sn-abc.googlevideo.com",
      },
      sidx,
      TOKEN,
    );
    expect(m3u8).toContain("https://inv.example/companion/videoplayback?");
    expect(m3u8).not.toContain(mt);
  });

  it("leaves every playlist as it was without a token", () => {
    const master = buildMasterPlaylist([avc720], pickAudioTracks([aacPlain]), [
      { label: "English", language_code: "en" },
    ]);
    expect(master).toBe(
      buildMasterPlaylist(
        [avc720],
        pickAudioTracks([aacPlain]),
        [{ label: "English", language_code: "en" }],
        null,
      ),
    );
    expect(master).not.toContain("mt=");
    expect(buildMediaPlaylist(avc720, sidx)).not.toContain("mt=");
    expect(buildSubtitlePlaylist("abc_DEF-123", "lang=nl", 60)).not.toContain(
      "mt=",
    );
  });
});
