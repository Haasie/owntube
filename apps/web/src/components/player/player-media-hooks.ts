"use client";

import { type RefObject, useEffect, useRef } from "react";
import type { PlayerAdapter } from "@/components/player/player-types";
import { readPlayerMediaPrefs } from "@/lib/player-media-prefs";

export function useReportVideoIntrinsics(
  videoRef: RefObject<HTMLVideoElement | null>,
  onVideoIntrinsics?: (width: number, height: number) => void,
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onVideoIntrinsics) return;
    const report = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onVideoIntrinsics(video.videoWidth, video.videoHeight);
      }
    };
    video.addEventListener("loadedmetadata", report);
    report();
    return () => video.removeEventListener("loadedmetadata", report);
  }, [videoRef, onVideoIntrinsics]);
}

/** Once when mini player is ready: volume + mute from user prefs (via adapter, not video.muted). */
export function useMiniPlayerMediaBootstrap(
  adapter: PlayerAdapter,
  miniMode: boolean,
  shortsMode: boolean,
  restoredVolume?: number,
  restoredMuted?: boolean,
) {
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!miniMode || shortsMode) return;
    if (!adapter.canPlay || appliedRef.current) return;
    appliedRef.current = true;
    const prefs = readPlayerMediaPrefs();
    const vol =
      typeof restoredVolume === "number" && Number.isFinite(restoredVolume)
        ? restoredVolume
        : prefs.volume;
    adapter.setVolume(vol);
    // A full→mini transition must never silence audio — only lift a mute if the
    // restored/pref state is explicitly unmuted. (Never force-mute the mini.)
    const muted =
      typeof restoredMuted === "boolean" ? restoredMuted : prefs.muted;
    if (adapter.muted && !muted) adapter.toggleMuted();
  }, [
    adapter,
    adapter.canPlay,
    miniMode,
    restoredVolume,
    restoredMuted,
    shortsMode,
  ]);
}

/**
 * Autoplay for Shorts / mini / regular-watch on native <video> (muxed + split).
 * `muteForAutoplayPolicy` forces muted from the first attempt (Shorts, where
 * autoplay must never audibly fail). Everywhere else, the first attempt tries
 * the viewer's actual volume; if the browser blocks unmuted autoplay (iOS
 * Safari always does without a very recent gesture), it retries muted so
 * playback actually starts instead of sitting paused at 0:00 indefinitely —
 * the adapter's volumechange listener picks up `el.muted` and shows the
 * unmute affordance, so the viewer can turn sound back on in one tap.
 */
export function useShortsNativeAutoplay(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  streamKey: string,
  muteForAutoplayPolicy = false,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey retriggers autoplay for a remounted native media source.
  useEffect(() => {
    if (!enabled) return;
    const el = videoRef.current;
    if (!el) return;

    let startedOnce = false;

    const tryPlay = () => {
      if (startedOnce || !el.paused || el.ended) return;
      if (muteForAutoplayPolicy) el.muted = true;
      void el.play().catch(() => {
        if (startedOnce || el.muted) return;
        el.muted = true;
        void el.play().catch(() => {
          /* autoplay policy — retried by the poll/events below */
        });
      });
    };

    // A single ready event or the play attempt itself may miss (the generated
    // HLS is still building its manifest on first mount), so poll as a reliable
    // backstop until the first `playing`.
    const poll = window.setInterval(tryPlay, 300);

    // Stop retrying once it's genuinely playing so we never fight a manual pause.
    const onPlaying = () => {
      startedOnce = true;
      window.clearInterval(poll);
    };
    el.addEventListener("playing", onPlaying);

    const readyEvents = [
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
    ] as const;
    for (const e of readyEvents) el.addEventListener(e, tryPlay);

    tryPlay();
    const stopPoll = window.setTimeout(
      () => window.clearInterval(poll),
      10_000,
    );

    return () => {
      startedOnce = true;
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
      el.removeEventListener("playing", onPlaying);
      for (const e of readyEvents) el.removeEventListener(e, tryPlay);
    };
  }, [enabled, muteForAutoplayPolicy, streamKey, videoRef]);
}
