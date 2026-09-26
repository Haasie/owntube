"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

/**
 * Secret addresses for the companion's podcast feeds: anyone with a feed's
 * URL can read it, no password required, so treat them like the private
 * links they are. Regenerating the password rotates every address (it's
 * derived from the password) and takes effect at the next publish cycle, so
 * old subscriptions keep working briefly. The plain username/password pair
 * still unlocks every feed at the protected, password-only addresses too —
 * regenerating changes that password as well.
 */
export function RssFeedsSection() {
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const query = trpc.settings.rssFeeds.useQuery();
  const regenerate = trpc.settings.regenerateRssPass.useMutation({
    onSuccess: () => {
      setConfirmRegenerate(false);
      void utils.settings.rssFeeds.invalidate();
    },
  });

  const creds = query.data;
  const queueUrls = creds?.queueUrls
    ? ([
        ["audio", creds.queueUrls.audio],
        ["video", creds.queueUrls.video],
      ] as const)
    : null;
  const hasAddresses = Boolean(queueUrls || creds?.feedsUrl);

  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Podcast feeds (RSS)</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Subscribe to your queue, playlists and channels in a podcast app.
        {hasAddresses
          ? " Each address below is a private link — anyone who has it can read that feed, so share it only with your own podcast app. Regenerating the password changes every address."
          : null}{" "}
        Media still only plays on the home network.
      </p>
      {creds ? (
        <div className="space-y-2 text-sm">
          {queueUrls
            ? queueUrls.map(([variant, url]) => (
                <div
                  key={variant}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-[hsl(var(--muted-foreground))]">
                    Queue feed ({variant})
                  </span>
                  <code className="max-w-full truncate rounded bg-[hsl(var(--muted))] px-1.5 py-0.5">
                    {url}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copy(variant, url)}
                  >
                    {copied === variant ? "Copied" : "Copy"}
                  </Button>
                </div>
              ))
            : null}
          {creds.feedsUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[hsl(var(--muted-foreground))]">
                All feeds (channels, playlists, saved)
              </span>
              <a
                className="max-w-full truncate underline"
                href={creds.feedsUrl}
                target="_blank"
                rel="noreferrer"
              >
                {creds.feedsUrl}
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy("feeds", creds.feedsUrl ?? "")}
              >
                {copied === "feeds" ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[hsl(var(--muted-foreground))]">
              Login for older subscriptions
            </span>
            <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5">
              {creds.username}
            </code>
            <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5">
              {creds.pass}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy("creds", `${creds.username}:${creds.pass}`)}
            >
              {copied === "creds" ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {confirmRegenerate ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerate.mutate()}
                  disabled={regenerate.isPending}
                >
                  {regenerate.isPending
                    ? "Regenerating…"
                    : "Yes, break existing subscriptions"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRegenerate(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmRegenerate(true)}
              >
                Regenerate password
              </Button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            A new password reaches the feed server at the next publish (within
            ~30 minutes); update your podcast apps afterwards.
          </p>
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
      )}
    </section>
  );
}
