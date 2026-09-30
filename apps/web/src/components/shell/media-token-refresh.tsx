"use client";

import { useEffect } from "react";
import {
  MEDIA_TOKEN_TTL_SEC,
  mediaTokenExpiry,
  pageMediaToken,
  setPageMediaToken,
} from "@/lib/media-token";

const CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * Keeps the page's media token (MediaTokenScript) alive in a tab left open for
 * longer than it lasts: past half its life it is swapped for a fresh one from
 * `/api/media-token`. Checked on an interval and whenever the tab comes back
 * into view, since a phone suspends timers in the background. Does nothing
 * when the page got no token.
 */
export function MediaTokenRefresh() {
  useEffect(() => {
    let inFlight = false;
    const refreshIfStale = async () => {
      const token = pageMediaToken();
      if (!token || inFlight) return;
      const expiry = mediaTokenExpiry(token);
      const leftMs = expiry === null ? 0 : expiry * 1000 - Date.now();
      if (leftMs > (MEDIA_TOKEN_TTL_SEC * 1000) / 2) return;
      inFlight = true;
      try {
        const r = await fetch("/api/media-token", { cache: "no-store" });
        if (!r.ok) return;
        const body = (await r.json()) as { token?: string | null };
        setPageMediaToken(body.token ?? null);
      } catch {
        // Offline or a login redirect: keep the current token, try again later.
      } finally {
        inFlight = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshIfStale();
    };
    const interval = window.setInterval(refreshIfStale, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    void refreshIfStale();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
