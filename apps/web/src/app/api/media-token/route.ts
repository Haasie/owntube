import { issueMediaToken } from "@/server/media/media-token";

// Minted per request; a token baked in at build time would be dead in 12 hours.
export const dynamic = "force-dynamic";

/**
 * A fresh media token for a page that has been open a while (see
 * MediaTokenRefresh). It mints, so like every page that does it stays behind
 * the reverse proxy's login: never add it to the auth-free media routes.
 */
export function GET(): Response {
  return Response.json(
    { token: issueMediaToken() },
    { headers: { "cache-control": "no-store" } },
  );
}
