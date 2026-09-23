import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ContinueWatchingRow } from "@/components/ContinueWatchingRow";
import { type HomeBlock, HomeBlockRow } from "@/components/HomeBlockRow";
import { SearchBar } from "@/components/SearchBar";
import { SkeletonRows } from "@/components/Skeleton";
import {
  Spotlight,
  SpotlightBackdrop,
  type SpotlightItem,
} from "@/components/Spotlight";
import { VideoRow } from "@/components/VideoRow";
import type { Nav } from "@/lib/navigation";
import { useRowScroll } from "@/lib/row-scroll";
import { useScreenActive } from "@/lib/screen-active";
import { trpc } from "@/lib/trpc-react";
import { colors, fontSize, spacing } from "@/theme";

/** The TV's own top row, when the web home has no Recommended block. */
const TOP_PICKS = 12;

/**
 * Home: a search bar and the spotlight (the focused card's details over its
 * blurred still) stay put at the top; below them scroll Continue watching,
 * Top picks (unless the web home already has a Recommended block), and the
 * blocks the user arranged on the web (`settings.homeBlocks`), one row each.
 * A row takes the top of the scroll area when one of its cards is focused.
 */
export function HomeScreen({ nav }: { nav: Nav }) {
  // Kept mounted while hidden: stop listening, refetch stale data on return.
  const subscribed = useScreenActive();
  const settings = trpc.settings.get.useQuery(undefined, { subscribed });
  const region = settings.data?.trendingRegion ?? "US";
  const top = trpc.feed.home.useQuery(
    { page: 1, pageSize: TOP_PICKS, region },
    { subscribed },
  );

  const blocks = settings.data?.homeBlocks ?? [];
  const topPicks = top.data?.videos ?? [];
  const personalized =
    top.data?.kind === "personalized" && top.data.coldStart !== true;
  const topLabel = personalized ? "Top pick for you" : "Trending now";
  const showTopPicks =
    topPicks.length > 0 && !blocks.some((b) => b.type === "recommended");

  /** The card under focus; the top pick until one is. */
  const [focused, setFocused] = useState<SpotlightItem | null>(null);
  const spotlight = useMemo<SpotlightItem | null>(() => {
    if (focused) return focused;
    const video = topPicks[0];
    return video ? { video, label: topLabel } : null;
  }, [focused, topPicks, topLabel]);

  const { scrollRef, onRowLayout, onHeaderLayout, scrollToRow, scrollToTop } =
    useRowScroll();
  const onCardFocus = useCallback(
    (key: string, video: UnifiedVideo, label: string) => {
      scrollToRow(key);
      setFocused({ video, label });
    },
    [scrollToRow],
  );
  const onTopPickFocus = useCallback(
    (isFocused: boolean, video?: UnifiedVideo) => {
      if (isFocused && video) onCardFocus("top", video, topLabel);
    },
    [onCardFocus, topLabel],
  );

  const loading = !settings.data && (settings.isPending || top.isPending);

  // The header is the ScrollView's sticky first child rather than a sibling
  // above it: Android's ScrollView swallows Up at its top edge, so a search
  // bar outside it could never take focus from the first row.
  const header = (
    <View style={styles.header} onLayout={onHeaderLayout}>
      {spotlight ? (
        <SpotlightBackdrop video={spotlight.video} variant="header" />
      ) : null}
      <SearchBar
        onPress={nav.openSearch}
        onFocusChange={(f) => f && scrollToTop()}
      />
      {spotlight ? (
        <Spotlight item={spotlight} />
      ) : (
        <View style={styles.headerGap} />
      )}
    </View>
  );

  return (
    <View style={styles.page}>
      {spotlight ? (
        <SpotlightBackdrop video={spotlight.video} variant="page" />
      ) : null}
      {loading ? (
        <View style={styles.content}>
          {header}
          <View style={styles.row}>
            <SkeletonRows rows={2} />
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          stickyHeaderIndices={[0]}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {header}
          <View style={styles.row} onLayout={(e) => onRowLayout("continue", e)}>
            <ContinueWatchingRow
              nav={nav}
              preferFirstFocus
              onCardFocus={(video) =>
                onCardFocus("continue", video, "Continue watching")
              }
            />
          </View>
          {showTopPicks ? (
            <View style={styles.row} onLayout={(e) => onRowLayout("top", e)}>
              <VideoRow
                title={personalized ? "Top picks for you" : "Trending now"}
                videos={topPicks}
                onSelect={(videoId) =>
                  nav.openVideo(videoId, {
                    context: { source: "feed", videos: topPicks },
                  })
                }
                onCardFocusChange={onTopPickFocus}
              />
            </View>
          ) : null}
          {blocks.map((block: HomeBlock) => (
            <View
              key={block.id}
              style={styles.row}
              onLayout={(e) => onRowLayout(block.id, e)}
            >
              <HomeBlockRow
                block={block}
                region={region}
                nav={nav}
                onCardFocus={(video, title) =>
                  onCardFocus(block.id, video, title)
                }
              />
            </View>
          ))}
          <Text style={styles.hint}>
            Rearrange these rows in Settings → Home rows, or on the web.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  // Full width of the scroll view, so its backdrop meets the page's and the
  // rows scrolling under it are covered edge to edge; the sticky wrapper
  // ignores a negative margin, so the rows carry the side padding instead.
  header: {
    gap: spacing.lg,
    paddingHorizontal: 8,
    paddingBottom: spacing.md,
    overflow: "hidden",
  },
  row: { paddingHorizontal: 8 },
  headerGap: { minHeight: 132 },
  content: {
    gap: spacing.xl,
    paddingTop: 8,
    paddingBottom: spacing.screen,
  },
  hint: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    paddingHorizontal: 8,
  },
});
