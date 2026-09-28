/**
 * Opt-in media request tracing (OWNTUBE_MEDIA_DEBUG=1): one stdout line per
 * manifest/segment/caption request with its status. Lets a playback failure
 * on a real device (e.g. iOS native HLS) be matched to the exact request that
 * broke — including requests a reverse proxy never let through (absent here).
 */
export async function withMediaDebug(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (process.env.OWNTUBE_MEDIA_DEBUG !== "1") return handler();
  const started = Date.now();
  const res = await handler();
  const u = new URL(request.url);
  const q = u.searchParams;
  const brief = ["itag", "xtags", "lang", "video"]
    .map((k) => (q.get(k) ? `${k}=${q.get(k)}` : ""))
    .filter(Boolean)
    .join("&");
  console.log(
    `[MEDIA] ${request.method} ${u.pathname}${brief ? `?${brief}` : ""} range=${request.headers.get("range") ?? "-"} -> ${res.status} ${res.headers.get("content-type") ?? ""} ${Date.now() - started}ms ua="${(request.headers.get("user-agent") ?? "").slice(0, 60)}"`,
  );
  return res;
}
