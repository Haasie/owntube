import { useState } from "react";
import { videoThumbnailUrl } from "@/lib/format";

/**
 * A video's thumbnail with fallbacks. A still can fail to load (an expired or
 * proxied link, or a request dropped when a screen fires dozens at once), and
 * the image would stay blank; `onError` steps to YouTube's own stills instead,
 * the smaller one last.
 */
export function useThumbnail(video: {
  videoId: string;
  thumbnailUrl?: string;
}) {
  const id = encodeURIComponent(video.videoId);
  const candidates = [
    videoThumbnailUrl(video),
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  ].filter((url, i, all) => all.indexOf(url) === i);
  // Keyed by video so a recycled card starts over at the first candidate.
  const [failed, setFailed] = useState({ videoId: video.videoId, count: 0 });
  const count = failed.videoId === video.videoId ? failed.count : 0;
  const uri = candidates[Math.min(count, candidates.length - 1)];
  const onError = () => setFailed({ videoId: video.videoId, count: count + 1 });
  return { uri, onError };
}
