import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import {
  generateMasterPlaylist,
  generateMediaPlaylist,
  getAdaptiveFormat,
  rewriteUpstreamUrl,
} from "@/server/services/hls/generate";

const M3U8_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const VIDEO_ID_RE = /^[\w-]{6,20}$/;

/**
 * Serves a synthesized VOD HLS manifest (see `generate.ts`):
 *   /hls/<videoId>/master.m3u8       -> variants + audio group
 *   /hls/<videoId>/media.m3u8?itag=… -> one stream's byte-range fragments
 *   /hls/<videoId>/stream.mp4?itag=… -> byte-range media segment proxy
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ parts?: string[] }> },
): Promise<Response> {
  return withMediaCors(await handleGET(request, context));
}

export function OPTIONS(): Response {
  return mediaCorsPreflight();
}

async function handleGET(
  request: Request,
  context: { params: Promise<{ parts?: string[] }> },
): Promise<Response> {
  const { parts } = await context.params;
  const [videoId, file] = parts ?? [];
  if (!videoId || !VIDEO_ID_RE.test(videoId) || !file) {
    return new Response("not found", { status: 404 });
  }

  try {
    if (file === "master.m3u8") {
      console.log(`[HLS] GET master.m3u8 videoId=${videoId}`);
      const body = await generateMasterPlaylist(videoId);
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "media.m3u8") {
      const params = new URL(request.url).searchParams;
      const itag = params.get("itag");
      if (!itag || !/^\d+$/.test(itag)) {
        return new Response("missing or invalid itag", { status: 400 });
      }
      // Multi-language audio: same itag per language, told apart by xtags
      // (colon-separated key=value pairs mirrored from the stream URL).
      const xtags = params.get("xtags");
      if (xtags && !/^[\w.:=-]{1,200}$/.test(xtags)) {
        return new Response("invalid xtags", { status: 400 });
      }
      console.log(`[HLS] GET media.m3u8 videoId=${videoId} itag=${itag} xtags=${xtags ?? "none"}`);
      const body = await generateMediaPlaylist(videoId, itag, xtags);
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "stream.mp4") {
      const params = new URL(request.url).searchParams;
      const itag = params.get("itag");
      if (!itag || !/^\d+$/.test(itag)) {
        return new Response("missing or invalid itag", { status: 400 });
      }
      const xtags = params.get("xtags");
      if (xtags && !/^[\w.:=-]{1,200}$/.test(xtags)) {
        return new Response("invalid xtags", { status: 400 });
      }

      const f = await getAdaptiveFormat(videoId, itag, xtags);
      if (!f || !f.url) {
        return new Response("format not found", { status: 404 });
      }

      const targetUrl = rewriteUpstreamUrl(f.url);
      const forwardHeaders: Record<string, string> = {};
      const range = request.headers.get("range");
      if (range) forwardHeaders.range = range;
      const ifRange = request.headers.get("if-range");
      if (ifRange) forwardHeaders["if-range"] = ifRange;

      const upstreamRes = await fetch(targetUrl, {
        headers: forwardHeaders,
        signal: request.signal,
        cache: "no-store",
      });

      const headers: Record<string, string> = {
        "content-type":
          upstreamRes.headers.get("content-type") ??
          (String(itag) === "140" ? "audio/mp4" : "video/mp4"),
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=3600",
      };
      const contentRange = upstreamRes.headers.get("content-range");
      if (contentRange) headers["content-range"] = contentRange;
      const contentLength = upstreamRes.headers.get("content-length");
      if (contentLength) headers["content-length"] = contentLength;

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers,
      });
    }
    return new Response("not found", { status: 404 });
  } catch (e) {
    console.error(`[HLS] FAILED videoId=${videoId} file=${file}:`, e);
    return new Response(`hls generation failed: ${(e as Error).message}`, {
      status: 502,
    });
  }
}
