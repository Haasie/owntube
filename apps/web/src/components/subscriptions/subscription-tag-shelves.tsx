"use client";

import { useEffect, useRef, useState } from "react";
import { SubscriptionTagShelf } from "@/components/home/home-blocks-client";

type Tag = { tag: string; count: number };

/**
 * Subscriptions > By tag: a scrollable row per tag with the newest uploads
 * from the channels carrying it. Each row mounts (and fetches) only once it
 * nears the viewport, so a long tag list doesn't fire every feed at once.
 */
export function SubscriptionTagShelves({
  tags,
  onOpenTag,
}: {
  tags: Tag[];
  /** A tag's heading: its whole feed (Everything, filtered to the tag). */
  onOpenTag: (tag: string) => void;
}) {
  if (tags.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No tags yet. Tag channels from their channel page to group them here.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {tags.map((t) => (
        <TagSection
          key={t.tag}
          tag={t.tag}
          count={t.count}
          onOpen={() => onOpenTag(t.tag)}
        />
      ))}
    </div>
  );
}

function TagSection({ tag, count, onOpen }: Tag & { onOpen: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setNear(true);
      },
      { rootMargin: "600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [near]);

  return (
    <section ref={ref} className="min-w-0 space-y-3">
      <h2 className="flex items-baseline gap-2 text-lg font-semibold">
        <button type="button" onClick={onOpen} className="hover:underline">
          {tag}
        </button>
        <span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">
          {count} {count === 1 ? "channel" : "channels"}
        </span>
      </h2>
      {near ? (
        <SubscriptionTagShelf tag={tag} />
      ) : (
        // Holds the row's height until it loads, so the page doesn't jump.
        <div className="h-56" aria-hidden />
      )}
    </section>
  );
}
