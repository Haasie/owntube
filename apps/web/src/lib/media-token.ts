/**
 * The `mt=<expiry>.<sig>` media token, the browser-safe half: carrying a token
 * into URLs. Minting and checking need AUTH_SECRET and live server-side in
 * `server/media/media-token.ts`, which also says why the token exists.
 *
 * googlevideo stream URLs carry an `mt` of their own (a bare Unix time), and
 * `/stream/videoplayback?…` passes their query through, so one URL can hold
 * both. Ours always has a dot; every helper here touches only that one.
 */

export const MEDIA_TOKEN_PARAM = "mt";

/** How long a minted token is accepted. */
export const MEDIA_TOKEN_TTL_SEC = 12 * 60 * 60;

/**
 * Path prefixes that answer 403 without a valid token once
 * MEDIA_TOKEN_REQUIRED=true: the routes a reverse proxy may leave outside its
 * login (README_COSMOS.md step 5).
 */
const GATED_PATH_PREFIXES = ["/hls/", "/stream/", "/captions/"] as const;

export function isMediaTokenGatedPath(pathname: string): boolean {
  return GATED_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/** An `mt` value shaped like ours rather than googlevideo's timestamp. */
export function isMediaTokenShaped(value: string): boolean {
  return /^\d+\.[\w-]+$/.test(value);
}

/** Every media-token-shaped `mt` value in `params`, in order. */
export function mediaTokensIn(params: URLSearchParams): string[] {
  return params.getAll(MEDIA_TOKEN_PARAM).filter(isMediaTokenShaped);
}

/** `params` minus our token, googlevideo's own `mt` and the order kept. */
export function withoutMediaToken(params: URLSearchParams): URLSearchParams {
  return new URLSearchParams(
    [...params].filter(
      ([k, v]) => k !== MEDIA_TOKEN_PARAM || !isMediaTokenShaped(v),
    ),
  );
}

/**
 * `url` with `mt=<token>` set, replacing a media token already there (but not
 * googlevideo's `mt`). Works on relative references too
 * (`media.m3u8?itag=137`). Appended as text rather than through
 * URLSearchParams, which would re-encode a signed googlevideo query. No token,
 * no change.
 */
export function withMediaToken(
  url: string,
  token: string | null | undefined,
): string {
  if (!token) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const kept =
    queryAt >= 0
      ? beforeHash
          .slice(queryAt + 1)
          .split("&")
          .filter((p) => p !== "" && !isMediaTokenPair(p))
      : [];
  kept.push(`${MEDIA_TOKEN_PARAM}=${encodeURIComponent(token)}`);
  return `${path}?${kept.join("&")}${hash}`;
}

function isMediaTokenPair(pair: string): boolean {
  const prefix = `${MEDIA_TOKEN_PARAM}=`;
  if (!pair.startsWith(prefix)) return false;
  try {
    return isMediaTokenShaped(decodeURIComponent(pair.slice(prefix.length)));
  } catch {
    return false;
  }
}

/**
 * `withMediaToken`, but only when `url` resolves to one of the gated routes
 * on `origin`: the token is for our own media routes and must never ride
 * along to an Invidious, companion or googlevideo URL. A relative `url`
 * resolves against `base` (default: `origin`).
 */
export function withMediaTokenIfGated(
  url: string,
  token: string | null | undefined,
  origin: string,
  base: string = origin,
): string {
  if (!token) return url;
  try {
    const u = new URL(url, base);
    if (u.origin !== new URL(origin).origin) return url;
    return isMediaTokenGatedPath(u.pathname) ? withMediaToken(url, token) : url;
  } catch {
    return url;
  }
}

declare global {
  interface Window {
    /** Set by MediaTokenScript before hydration, refreshed by MediaTokenRefresh. */
    __owntubeMediaToken?: string;
  }
}

/**
 * The token the server handed this page, for media URLs built in the
 * browser (shorts, card previews, hls.js rewrites). Null during SSR, where
 * callers pass the token they minted, and when enforcement is off.
 */
export function pageMediaToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.__owntubeMediaToken || null;
}

export function setPageMediaToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.__owntubeMediaToken = token;
  else delete window.__owntubeMediaToken;
}

/** When `token` stops being accepted, in Unix seconds; null if malformed. */
export function mediaTokenExpiry(token: string): number | null {
  const m = /^(\d{1,12})\./.exec(token);
  return m?.[1] ? Number(m[1]) : null;
}
