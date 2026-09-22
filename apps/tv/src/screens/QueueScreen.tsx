import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { StyleSheet, Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { FocusButton } from "@/components/FocusButton";
import type { Nav, PlayContext } from "@/lib/navigation";
import { playAllStart } from "@/lib/play-all";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useProgressLookup } from "@/lib/watch-progress";
import { colors, fontSize, spacing } from "@/theme";

/**
 * The watch queue, in queue order. `listDetailed` returns the whole queue in
 * one shot (it is user-curated and short), so there is no pagination — the
 * shelves are just chunked by CarouselFeed.
 *
 * Anything played from here plays on through the queue; the server drops each
 * video from the queue once it is watched to the end.
 */
export function QueueScreen({ nav }: { nav: Nav }) {
  const progress = useProgressLookup();
  const feed = useInfiniteFeed<never>(
    () =>
      trpcClient.queue.listDetailed.query().then((rows) => ({
        items: rows.map((row) => ({
          videoId: row.videoId,
          title: row.videoTitle,
          thumbnailUrl: row.thumbnailUrl,
          // listDetailed falls back to channelId, which is nullable.
          channelName: row.channelName ?? undefined,
        })),
        next: undefined,
      })),
    [],
    "queue.listDetailed",
  );

  const play = (videoId: string, videos: UnifiedVideo[]) => {
    const context: PlayContext = { source: "queue", label: "Queue", videos };
    nav.openVideo(videoId, { context });
  };
  const first = playAllStart(feed.videos, progress);

  return (
    <CarouselFeed
      feed={feed}
      onSelect={play}
      header={
        <View style={styles.header}>
          <Text style={styles.heading}>Queue</Text>
          {first ? (
            <FocusButton
              label="Play all"
              variant="primary"
              onPress={() => play(first.videoId, feed.videos)}
            />
          ) : null}
        </View>
      }
      emptyText="Your queue is empty."
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
});
