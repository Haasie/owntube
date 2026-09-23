import { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { HomeBlockRow } from "@/components/HomeBlockRow";
import { HomeHero } from "@/components/HomeHero";
import { baseUrl } from "@/lib/config";
import type { Nav } from "@/lib/navigation";
import { useScreenActive } from "@/lib/screen-active";
import { trpc } from "@/lib/trpc-react";
import { colors, fontSize, spacing } from "@/theme";

/**
 * Home mirrors the web home: the blocks the user arranged there
 * (`settings.homeBlocks`), one row each, in their order. Above them sit the
 * TV's own hero — the top recommendation — and Continue watching. The web
 * stays the editor; the footer says where.
 */
export function HomeScreen({ nav }: { nav: Nav }) {
  // Kept mounted while hidden: stop listening, refetch stale data on return.
  const subscribed = useScreenActive();
  const settings = trpc.settings.get.useQuery(undefined, { subscribed });
  const region = settings.data?.trendingRegion ?? "US";
  const top = trpc.feed.home.useQuery(
    { page: 1, pageSize: 12, region },
    { subscribed },
  );

  const heroVideo = top.data?.videos[0];
  const personalized =
    top.data?.kind === "personalized" && top.data.coldStart !== true;
  const blocks = settings.data?.homeBlocks ?? [];

  /**
   * Android scrolls a focused card into view by the least it can, which left
   * the hero sliced through the middle whenever focus sat on the first row.
   * Instead the focused row is brought to the top of the screen, like the
   * YouTube and Plex clients do; moving up to the hero scrolls it back in.
   */
  const scrollRef = useRef<ScrollView>(null);
  const rowTops = useRef(new Map<string, number>());
  const onRowLayout = useCallback((key: string, e: LayoutChangeEvent) => {
    rowTops.current.set(key, e.nativeEvent.layout.y);
  }, []);
  const scrollToRow = useCallback((key: string) => {
    const top = rowTops.current.get(key);
    if (top === undefined) return;
    scrollRef.current?.scrollTo({ y: top - spacing.lg, animated: true });
  }, []);

  if (!heroVideo && (top.isPending || settings.isPending)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {heroVideo ? (
        <HomeHero
          video={heroVideo}
          label={personalized ? "Top pick for you" : "Trending now"}
          onPress={(videoId) =>
            nav.openVideo(videoId, {
              context: { source: "feed", videos: top.data?.videos ?? [] },
            })
          }
        />
      ) : null}
      <View onLayout={(e) => onRowLayout("continue", e)}>
        <ContinueWatchingRow
          nav={nav}
          onCardFocusChange={(focused) => focused && scrollToRow("continue")}
        />
      </View>
      {blocks.map((block) => (
        <View key={block.id} onLayout={(e) => onRowLayout(block.id, e)}>
          <HomeBlockRow
            block={block}
            region={region}
            nav={nav}
            onCardFocusChange={(focused) => focused && scrollToRow(block.id)}
          />
        </View>
      ))}
      <Text style={styles.hint}>
        Customise these rows on the web: {baseUrl().replace(/^https?:\/\//, "")}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    gap: spacing.xl,
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: spacing.screen,
  },
  hint: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
