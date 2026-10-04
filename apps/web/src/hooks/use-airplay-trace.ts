"use client";

import { useEffect } from "react";

/**
 * TEMPORARY diagnostics: AirPlay from iOS stutters roughly every 40 s while
 * the Apple TV's own segment fetches look healthy server-side. While the
 * element plays to a wireless target, report each media event the page sees
 * (with position and buffer) to /api/client-log so the stutter can be matched
 * to what the page does at that moment. Remove once diagnosed.
 */

type WirelessVideo = HTMLVideoElement & {
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

const MEDIA_EVENTS = [
  "waiting",
  "stalled",
  "seeking",
  "seeked",
  "pause",
  "play",
  "playing",
  "ratechange",
  "emptied",
  "abort",
  "error",
  "loadstart",
  "durationchange",
  "suspend",
] as const;

function bufferAhead(v: HTMLVideoElement): number | null {
  const t = v.currentTime;
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= t + 0.25 && v.buffered.end(i) >= t) {
      return Math.round((v.buffered.end(i) - t) * 10) / 10;
    }
  }
  return null;
}

export function useAirPlayTrace(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  reactKey: string,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the <video> is keyed by reactKey, so a new stream is a new element to listen on.
  useEffect(() => {
    const v = videoRef.current as WirelessVideo | null;
    if (!v) return;
    const started = performance.now();
    let sentThisSecond = 0;
    let second = 0;
    const send = (event: string, extra?: Record<string, unknown>) => {
      const now = Math.floor((performance.now() - started) / 1000);
      if (now !== second) {
        second = now;
        sentThisSecond = 0;
      }
      if (++sentThisSecond > 4) return;
      void fetch("/api/client-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          component: "airplay-trace",
          event,
          sinceMountS: Math.round((performance.now() - started) / 100) / 10,
          t: Math.round(v.currentTime * 10) / 10,
          bufferAheadS: bufferAhead(v),
          readyState: v.readyState,
          paused: v.paused,
          wireless: v.webkitCurrentPlaybackTargetIsWireless ?? null,
          ...extra,
        }),
        keepalive: true,
      }).catch(() => {});
    };
    const wireless = () => v.webkitCurrentPlaybackTargetIsWireless === true;

    const onMedia = (e: Event) => {
      if (wireless()) send(e.type);
    };
    const onTarget = () => send("wireless-target-changed");
    const onTextTracks = () => {
      if (!wireless()) return;
      const modes: string[] = [];
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i];
        if (tt && tt.mode !== "disabled") modes.push(`${tt.label}:${tt.mode}`);
      }
      send("texttracks-change", { activeTextTracks: modes });
    };
    const audioTracks = (
      v as HTMLVideoElement & {
        audioTracks?: EventTarget & {
          length: number;
          [i: number]: { label: string; enabled: boolean };
        };
      }
    ).audioTracks;
    const onAudioTracks = () => {
      if (!wireless() || !audioTracks) return;
      let enabled: string | null = null;
      for (let i = 0; i < audioTracks.length; i++) {
        if (audioTracks[i]?.enabled) enabled = audioTracks[i]?.label ?? null;
      }
      send("audiotracks-change", { enabledAudio: enabled });
    };
    // While wireless, a heartbeat every 5 s shows position/buffer between events.
    const heartbeat = window.setInterval(() => {
      if (wireless()) send("heartbeat");
    }, 5000);

    for (const ev of MEDIA_EVENTS) v.addEventListener(ev, onMedia);
    v.addEventListener(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onTarget,
    );
    v.textTracks.addEventListener?.("change", onTextTracks);
    audioTracks?.addEventListener?.("change", onAudioTracks);
    return () => {
      window.clearInterval(heartbeat);
      for (const ev of MEDIA_EVENTS) v.removeEventListener(ev, onMedia);
      v.removeEventListener(
        "webkitcurrentplaybacktargetiswirelesschanged",
        onTarget,
      );
      v.textTracks.removeEventListener?.("change", onTextTracks);
      audioTracks?.removeEventListener?.("change", onAudioTracks);
    };
  }, [videoRef, reactKey]);
}
