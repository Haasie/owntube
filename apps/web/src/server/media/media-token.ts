import { createHmac, timingSafeEqual } from "node:crypto";
import { MEDIA_TOKEN_TTL_SEC, mediaTokensIn } from "@/lib/media-token";

/**
 * Signed, expiring media tokens: what lets `/hls`, `/stream` and `/captions`
 * sit outside a reverse proxy's login without becoming an open YouTube proxy.
 * They have to sit outside it on iPhone: AVPlayer fetches HLS playlists and
 * segments itself, without the page's login cookie (README_COSMOS.md step 5).
 *
 * A token is `<expiry>.<sig>`: expiry in Unix seconds, sig =
 * base64url(HMAC-SHA256(key, expiry)), the key derived from AUTH_SECRET. It
 * names no video, because segment URLs carry googlevideo ids rather than the
 * public one, so a video-bound token couldn't be checked there. It proves
 * that OwnTube minted the URL, for a page that got past the login, less than
 * MEDIA_TOKEN_TTL_SEC ago.
 *
 * Who mints: pages and routes that sit behind the login (the watch page, the
 * root layout, `/api/media-token`, `/dash`, `/yt-hls`, `/enclosure`). The
 * auth-free routes only check the token and pass the same one on into the
 * URLs they serve, so a playback session never outlives its page's token.
 *
 * Enforced only with MEDIA_TOKEN_REQUIRED=true. Off, nothing is minted and
 * every URL stays exactly as it was.
 */

/** Separates this key from every other use of AUTH_SECRET (sessions, device tokens). */
const KEY_LABEL = "owntube.media-token.v1";

const SIG_RE = /^[A-Za-z0-9_-]{43}$/; // base64url SHA-256, unpadded

export function isMediaTokenRequired(): boolean {
  return process.env.MEDIA_TOKEN_REQUIRED === "true";
}

function signingKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function signature(key: Buffer, expiry: string): string {
  return createHmac("sha256", key).update(expiry).digest("base64url");
}

export function signMediaToken(
  nowMs: number = Date.now(),
  ttlSec: number = MEDIA_TOKEN_TTL_SEC,
): string {
  const key = signingKey();
  if (!key) throw new Error("AUTH_SECRET is not set");
  const expiry = String(Math.floor(nowMs / 1000) + ttlSec);
  return `${expiry}.${signature(key, expiry)}`;
}

export function verifyMediaToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (dot < 1 || !/^\d{1,12}$/.test(expiry) || !SIG_RE.test(sig)) {
    return false;
  }
  if (Number(expiry) * 1000 <= nowMs) return false;
  const key = signingKey();
  if (!key) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(signature(key, expiry)));
}

/**
 * A token for URLs going into a page or manifest now, or null when
 * enforcement is off (or AUTH_SECRET is missing, in which case every gated
 * request is refused rather than served unchecked).
 */
export function issueMediaToken(nowMs: number = Date.now()): string | null {
  if (!isMediaTokenRequired() || !signingKey()) return null;
  return signMediaToken(nowMs);
}

/**
 * The request's media token when it verifies, else null. Looked for among
 * every `mt`: a proxied googlevideo query brings its own, first.
 */
export function requestMediaToken(
  request: Request,
  nowMs: number = Date.now(),
): string | null {
  const tokens = mediaTokensIn(new URL(request.url).searchParams);
  return tokens.find((t) => verifyMediaToken(t, nowMs)) ?? null;
}

/**
 * The token an auth-free route passes on into the URLs it serves: the
 * request's own, already checked by `mediaTokenDenial`. Null when enforcement
 * is off, so manifests stay unchanged.
 */
export function passOnMediaToken(request: Request): string | null {
  return isMediaTokenRequired() ? requestMediaToken(request) : null;
}

/**
 * Gate for the auth-free media routes: a 403 when MEDIA_TOKEN_REQUIRED=true
 * and the request carries no valid `mt`, else null (serve it).
 */
export function mediaTokenDenial(request: Request): Response | null {
  if (!isMediaTokenRequired() || requestMediaToken(request)) return null;
  return new Response("missing, invalid or expired media token", {
    status: 403,
    headers: { "cache-control": "no-store" },
  });
}
