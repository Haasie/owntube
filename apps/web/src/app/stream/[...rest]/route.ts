import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import { withMediaDebug } from "@/lib/media-debug";
import { mediaTokenDenial, passOnMediaToken } from "@/server/media/media-token";
import {
  assetKindForSubpath,
  handleUpstreamMediaRequest,
  proxySubpath,
  STREAM_PROXY_PREFIX,
} from "@/server/media/upstream-proxy";

/**
 * Byte-range media and HLS manifests, served same-origin with the media origin
 * (see `media-origin.ts`) so the browser and hls.js are not blocked by CORS.
 * Playlists are text-rewritten so absolute segment URLs land here too.
 *
 * Named for what it does rather than where the bytes come from — the upstream is
 * a config detail. Replaces `/invidious/…`, which is kept as an alias while
 * cached manifests still reference it (Phase 5).
 *
 * With MEDIA_TOKEN_REQUIRED=true everything but images needs a valid `mt` (see
 * server/media/media-token.ts). Thumbnails and avatars stay open: every page
 * shows them, <img> can't be handed a fresh token, and an image proxy is no
 * video proxy.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ rest?: string[] }> },
) {
  const { rest } = await context.params;
  return withMediaCors(
    await withMediaDebug(request, async () => {
      const subpath = proxySubpath(request, STREAM_PROXY_PREFIX, rest);
      if (assetKindForSubpath(subpath) === null) {
        const denied = mediaTokenDenial(request);
        if (denied) return denied;
      }
      return handleUpstreamMediaRequest(request, {
        segments: rest,
        prefix: STREAM_PROXY_PREFIX,
        mediaToken: passOnMediaToken(request),
      });
    }),
  );
}

export function OPTIONS(): Response {
  return mediaCorsPreflight();
}
