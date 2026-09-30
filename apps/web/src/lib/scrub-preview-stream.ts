import {
  type CardPreviewPlayback,
  cardPreviewPlaybackFromDetail,
} from "@/lib/card-preview-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

/** Low-bitrate stream for timeline scrub preview (separate from main playback). */
export function scrubPreviewStreamFromDetail(
  detail: VideoDetail,
  appOrigin: string,
  requestHost: string,
  /** See toStreamProxyUrl; server callers pass the token they minted. */
  mediaToken?: string | null,
): string | null {
  const playback: CardPreviewPlayback | null = cardPreviewPlaybackFromDetail(
    detail,
    appOrigin,
    requestHost,
    mediaToken,
  );
  if (!playback) return null;
  if (playback.kind === "muxed" || playback.kind === "hls") return playback.src;
  return playback.videoSrc;
}
