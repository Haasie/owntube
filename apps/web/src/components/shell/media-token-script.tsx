/**
 * Hands the page its media token (lib/media-token.ts) before hydration, so
 * media URLs built in the browser (shorts, card previews, hls.js rewrites)
 * carry it from the first render. Renders nothing when enforcement is off.
 */
export function MediaTokenScript({ token }: { token: string | null }) {
  if (!token) return null;
  // The token is digits, a dot and base64url: nothing to escape in a script.
  const script = `window.__owntubeMediaToken=${JSON.stringify(token)};`;
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: inline boot script
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
