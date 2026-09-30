#!/bin/sh
# Hop-by-hop playback probe for one video: where do the media bytes stop?
#
#   sh scripts/diagnose-playback.sh [videoId] [app-url]
#
# Run on the Docker host. Read-only: it fetches a few 2 MB ranges and prints
# what each hop answered; it changes nothing.
#   1. the protocol the browser gets from the reverse proxy (HTTP/2 wedges
#      Safari's media loads — see README_COSMOS.md)
#   2. from inside the owntube container, the same byte ranges through each
#      upstream: the Invidious instance's /videoplayback, the companion's
#      /companion/videoplayback, and OwnTube's own /stream proxy (the URL the
#      browser uses), at 0 / 30 / 60 / 90 % into the file
#   3. the HLS playlist, first video playlist and init segment fetched the way
#      the iPhone's player (AVPlayer) fetches them: through the reverse proxy,
#      without the login cookie (but with a media token when
#      MEDIA_TOKEN_REQUIRED=true, as the page would hand it)
#   4. from the last 30 minutes of the owntube log: which of the iPhone
#      player's requests reached OwnTube, plus media errors and player reports
set -eu

VIDEO_ID=${1:-aqz-KE-bpKQ}
APP_URL=${2:-https://youtube.haasie.nl}
CONTAINER=${OWNTUBE_CONTAINER:-owntube}

echo "== 1. Protocol the browser gets from $APP_URL"
curl -sS -o /dev/null --http2 --max-time 15 \
  -w '   negotiated HTTP/%{http_version}, status %{http_code}\n' "$APP_URL/" ||
  echo "   (unreachable from this host)"
curl -sSI --http2 --max-time 15 "$APP_URL/" 2>/dev/null |
  grep -iE '^(server|cf-ray|via):' | sed 's/^/   /' || true
echo "   HTTP/2 here + stalls only in Safari/iOS => turn HTTP/2 off on the proxy (README_COSMOS.md)"

echo
echo "== 2. Server-side hops for $VIDEO_ID (inside $CONTAINER)"
docker exec -i -e VIDEO_ID="$VIDEO_ID" "$CONTAINER" node --input-type=module - <<'NODE'
const id = process.env.VIDEO_ID;
const trim = (s) => (s ?? "").trim().replace(/\/+$/, "");
const inv = trim(process.env.INVIDIOUS_BASE_URL);
const companion = trim(process.env.INVIDIOUS_COMPANION_INTERNAL_URL);
const self = `http://127.0.0.1:${process.env.PORT || 3000}`;
const CHUNK = 2 * 1024 * 1024;
const OFFSETS = [0, 0.3, 0.6, 0.9];

console.log(
  `   INVIDIOUS_STREAM_VIA_COMPANION=${process.env.INVIDIOUS_STREAM_VIA_COMPANION ?? "(unset)"}`,
);
console.log(
  `   MEDIA_TOKEN_REQUIRED=${process.env.MEDIA_TOKEN_REQUIRED ?? "(unset)"}`,
);

// OwnTube's own /stream and /hls want a media token when MEDIA_TOKEN_REQUIRED
// is on; take one the way a long-open page does.
const mt = await fetch(`${self}/api/media-token`)
  .then((r) => r.json())
  .then((j) => j.token ?? "")
  .catch(() => "");
const withMt = (url) => (mt ? `${url}${url.includes("?") ? "&" : "?"}mt=${mt}` : url);

async function timed(url, range, timeoutMs = 20_000) {
  const t0 = performance.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: range ? { range } : {},
      signal: ac.signal,
    });
    const ttfb = performance.now() - t0;
    let bytes = 0;
    if (r.body) for await (const c of r.body) bytes += c.byteLength;
    return { status: r.status, ttfb, ms: performance.now() - t0, bytes };
  } catch (e) {
    const why = e?.name === "AbortError" ? `timeout after ${timeoutMs} ms` : String(e?.cause?.code ?? e?.message ?? e);
    return { error: why, ms: performance.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const detailUrl = `${inv}/api/v1/videos/${encodeURIComponent(id)}?local=true`;
const t0 = performance.now();
const detailRes = await fetch(detailUrl).catch((e) => ({ status: String(e?.cause?.code ?? e) }));
console.log(`   /api/v1/videos: ${detailRes.status} in ${Math.round(performance.now() - t0)} ms`);
if (detailRes.status !== 200) process.exit(0);
const detail = await detailRes.json();
const adaptive = detail.adaptiveFormats ?? [];
const byBitrate = (a, b) => Number(b.bitrate) - Number(a.bitrate);
const picks = [
  ["video", adaptive.filter((f) => /avc1/.test(f.type) && f.url).sort(byBitrate)[0]],
  ["audio", adaptive.filter((f) => /mp4a/.test(f.type) && f.url).sort(byBitrate)[0]],
  ["muxed", (detail.formatStreams ?? []).find((f) => String(f.itag) === "18")],
].filter(([, f]) => f);

/** Finding -> offsets it showed up at, so the verdict reads one line per problem. */
const verdicts = new Map();
const note = (finding, at) => {
  const offsets = verdicts.get(finding) ?? [];
  if (at) offsets.push(at.trim());
  verdicts.set(finding, offsets);
};
for (const [kind, f] of picks) {
  const u = new URL(f.url);
  const q = u.searchParams;
  const clen = Number(f.clen ?? q.get("clen") ?? 0);
  const bps = Number(f.bitrate ?? 0) / 8;
  const ip = q.get("ip") ?? "";
  console.log(
    `\n   ${kind} itag ${f.itag} ${f.qualityLabel ?? f.resolution ?? ""} — c=${q.get("c")} pot=${q.has("pot") ? "yes" : "no"} ip=${ip.includes(":") ? "IPv6" : ip ? "IPv4" : "-"} clen=${(clen / 1e6).toFixed(1)}MB`,
  );
  if (ip.includes(":")) {
    note("URLs are locked to an IPv6 address, but Invidious's /videoplayback always fetches over IPv4: use the companion route (INVIDIOUS_STREAM_VIA_COMPANION=true)");
  }
  const hops = [
    ["instance ", `${inv}${u.pathname}${u.search}`],
    ...(companion ? [["companion", `${companion}/companion/videoplayback${u.search}`]] : []),
    ["owntube  ", withMt(`${self}/stream${u.pathname}${u.search}`)],
  ];
  for (const offset of OFFSETS) {
    const start = Math.floor(clen * offset);
    if (clen && start >= clen) continue;
    const end = clen ? Math.min(start + CHUNK, clen) - 1 : start + CHUNK - 1;
    for (const [name, url] of hops) {
      const r = await timed(url, `bytes=${start}-${end}`);
      const at = `${String(Math.round(offset * 100)).padStart(2)}%`;
      if (r.error) {
        console.log(`     ${at} ${name}  ${r.error}`);
        note(`${name.trim()}: ${r.error} for ${kind}`, at);
        continue;
      }
      const secs = r.ms / 1000;
      const realtime = r.status < 400 && bps > 0 ? r.bytes / secs / bps : 0;
      console.log(
        `     ${at} ${name}  ${r.status}  ttfb ${String(Math.round(r.ttfb)).padStart(5)} ms  ${(r.bytes / 1e6).toFixed(2)} MB in ${secs.toFixed(1)} s${realtime ? `  ${realtime.toFixed(1)}x realtime` : ""}`,
      );
      if (r.status >= 400) note(`${name.trim()}: ${r.status} for ${kind}`, at);
      else if (realtime && realtime < 1.5) note(`${name.trim()}: ${kind} only ${realtime.toFixed(1)}x realtime (throttled, playback can't keep up)`, at);
    }
  }
}

for (const path of [`/hls/${id}/master.m3u8`]) {
  const r = await timed(withMt(`${self}${path}`));
  console.log(`\n   ${path}: ${r.error ?? r.status} in ${Math.round(r.ms)} ms`);
}

console.log("\n   Verdict:");
if (verdicts.size === 0) {
  console.log("   every hop serves every offset faster than realtime: the server side is fine;");
  console.log("   look at the browser <-> reverse proxy leg (HTTP/2, section 1).");
} else {
  for (const [finding, offsets] of verdicts) {
    console.log(`   - ${finding}${offsets.length ? ` (at ${offsets.join(", ")})` : ""}`);
  }
}
NODE

echo
echo "== 3. What the iPhone's player gets from $APP_URL without cookies"
# iOS plays HLS through AVPlayer, which fetches the playlists and segments
# itself and does not send the page's login cookie. Ask exactly what it asks.
PUB="$APP_URL/hls/$VIDEO_ID"
body=$(mktemp)
trap 'rm -f "$body"' EXIT
# With MEDIA_TOKEN_REQUIRED=true the page hands the player a media token (mt=)
# that every URL after the master carries on its own; take one from OwnTube.
MT=$(docker exec "$CONTAINER" node -e 'fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/media-token`).then((r) => r.json()).then((j) => process.stdout.write(j.token || "")).catch(() => {})' 2>/dev/null || true)
QS=""
if [ -n "$MT" ]; then
  res=$(curl -sS -o /dev/null --max-time 20 -w '%{http_code}' "$PUB/master.m3u8" 2>&1) || res="failed: $res"
  echo "   master.m3u8 without mt= -> $res (403: OwnTube refuses URLs it didn't hand out, as it should)"
  QS="?mt=$MT"
fi
res=$(curl -sS -o "$body" --max-time 20 -w '%{http_code} %{content_type} %{redirect_url}' "$PUB/master.m3u8$QS" 2>&1) ||
  res="failed: $res"
echo "   master.m3u8        -> $res"
if head -c 7 "$body" | grep -q '#EXTM3U'; then
  media=$(grep -m1 '^media\.m3u8' "$body" || true)
  if [ -n "$media" ]; then
    res=$(curl -sS -o "$body" --max-time 30 -w '%{http_code} %{content_type}' "$PUB/$media" 2>&1) || res="failed: $res"
    echo "   $media -> $res"
    map=$(sed -n 's/^#EXT-X-MAP:URI="\([^"]*\)",BYTERANGE="\([0-9]*\)@\([0-9]*\)".*/\1 \2 \3/p' "$body" | head -1)
    if [ -n "$map" ]; then
      # shellcheck disable=SC2086 # three space-separated fields, none with spaces
      set -- $map
      case $1 in /*) seg="$APP_URL$1" ;; http*) seg=$1 ;; *) seg="$PUB/$1" ;; esac
      range="bytes=$3-$(($3 + $2 - 1))"
      res=$(curl -sS -o /dev/null --max-time 30 -H "Range: $range" \
        -w '%{http_code} %{content_type} %{size_download} bytes' "$seg" 2>&1) || res="failed: $res"
      echo "   init segment ($range) -> $res"
    fi
  fi
  echo "   => the playlist reaches the player without cookies; if native HLS still fails,"
  echo "      the lines above and section 4 show which request it didn't like"
elif grep -q 'media token' "$body"; then
  echo "   => OwnTube refused the media token (MEDIA_TOKEN_REQUIRED=true): no valid one could be"
  echo "      taken from $CONTAINER. Is AUTH_SECRET set on it?"
else
  snippet=$(head -c 80 "$body" | tr -s '\n\r\t' ' ')
  echo "   => NOT a playlist: ${snippet:-the answer above}"
  echo "      That is the native-HLS failure on the iPhone (MEDIA_ERR_SRC_NOT_SUPPORTED): the"
  echo "      reverse proxy's login stands between AVPlayer and OwnTube. README_COSMOS.md, step 5."
fi

echo
echo "== 4. The owntube log, last 30 min"
logs=$(docker logs --since 30m "$CONTAINER" 2>&1 || true)
if ! printf '%s\n' "$logs" | grep -q '\[MEDIA\]'; then
  echo "   no [MEDIA] lines at all: set OWNTUBE_MEDIA_DEBUG=1 on owntube, try the video on the"
  echo "   phone, run this again"
else
  apple=$(printf '%s\n' "$logs" | grep '\[MEDIA\]' | grep 'AppleCoreMedia' || true)
  if [ -z "$apple" ]; then
    echo "   none of the iPhone player's requests (user agent AppleCoreMedia) reached OwnTube:"
    echo "   they were stopped in front of it (see section 3). Tried the video on the phone first?"
  else
    echo "   the iPhone player's requests (AppleCoreMedia), newest last:"
    printf '%s\n' "$apple" | tail -20 | sed 's/^/     /'
  fi
fi
errors=$(printf '%s\n' "$logs" |
  grep -E '\[MEDIA\].* -> [45][0-9][0-9]|trying the next upstream|\[CLIENT-LOG\]' | tail -20 || true)
if [ -n "$errors" ]; then
  echo "   media errors and player reports:"
  printf '%s\n' "$errors" | sed 's/^/     /'
fi
