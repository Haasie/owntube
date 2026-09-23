import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type HomeBlock, HomeBlockRow } from "@/components/HomeBlockRow";
import type { FeatherName } from "@/components/Sidebar";
import type { Nav } from "@/lib/navigation";
import { useRowScroll } from "@/lib/row-scroll";
import { useActiveBackHandler, useScreenActive } from "@/lib/screen-active";
import { trpc } from "@/lib/trpc-react";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { PlaylistsScreen } from "@/screens/PlaylistsScreen";
import { QueueScreen } from "@/screens/QueueScreen";
import { SavedScreen } from "@/screens/SavedScreen";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type Page = "history" | "queue" | "saved" | "playlists";

const TILES: { key: Page; label: string; icon: FeatherName }[] = [
  { key: "history", label: "History", icon: "clock" },
  { key: "queue", label: "Queue", icon: "list" },
  { key: "saved", label: "Saved", icon: "bookmark" },
  { key: "playlists", label: "Playlists", icon: "folder" },
];

/**
 * The four library rows as home blocks, so the same component renders them
 * here and on Home. The layout fields are the web's; a TV row ignores them.
 */
const ROWS = TILES.map(
  (tile): HomeBlock => ({
    id: `library-${tile.key}`,
    type: tile.key,
    limit: 24,
    rows: 1,
    layout: "rows",
    size: "md",
  }),
);

/**
 * Everything the user has kept, in one place — the YouTube TV client's
 * Library page: a tile per collection, then a row of each. A tile opens the
 * full page (History, Queue, Saved, Playlists), and Back returns here.
 */
export function LibraryScreen({ nav }: { nav: Nav }) {
  const [page, setPage] = useState<Page | null>(null);
  /** Focus lands back on the tile that was opened, not the first one. */
  const [lastTile, setLastTile] = useState<Page>("history");
  useActiveBackHandler(() => {
    if (!page) return false;
    setPage(null);
    return true;
  });

  // Kept mounted while hidden: stop listening, refetch stale data on return.
  // The rows below fetch the same lists, so these reads are shared, not extra.
  const subscribed = useScreenActive();
  const settings = trpc.settings.get.useQuery(undefined, { subscribed });
  const queue = trpc.queue.listDetailed.useQuery(undefined, { subscribed });
  const saved = trpc.interactions.listSaved.useQuery(undefined, {
    subscribed,
  });
  const playlists = trpc.playlists.list.useQuery(undefined, { subscribed });
  const counts: Partial<Record<Page, number>> = {
    queue: queue.data?.length,
    saved: saved.data?.length,
    playlists: playlists.data?.length,
  };

  const { scrollRef, onRowLayout, scrollToRow, scrollToTop } = useRowScroll();

  switch (page) {
    case "history":
      return <HistoryScreen nav={nav} />;
    case "queue":
      return <QueueScreen nav={nav} />;
    case "saved":
      return <SavedScreen nav={nav} />;
    case "playlists":
      return <PlaylistsScreen nav={nav} />;
    default:
      break;
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Library</Text>
      <View style={styles.tiles}>
        {TILES.map((tile) => (
          <LibraryTile
            key={tile.key}
            label={tile.label}
            icon={tile.icon}
            count={counts[tile.key]}
            hasTVPreferredFocus={tile.key === lastTile}
            onFocusChange={(focused) => focused && scrollToTop()}
            onPress={() => {
              setLastTile(tile.key);
              setPage(tile.key);
            }}
          />
        ))}
      </View>
      {ROWS.map((block) => (
        <View key={block.id} onLayout={(e) => onRowLayout(block.id, e)}>
          <HomeBlockRow
            block={block}
            region={settings.data?.trendingRegion ?? "US"}
            nav={nav}
            onCardFocusChange={(focused) => focused && scrollToRow(block.id)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function LibraryTile({
  label,
  icon,
  count,
  hasTVPreferredFocus,
  onFocusChange,
  onPress,
}: {
  label: string;
  icon: FeatherName;
  count?: number;
  hasTVPreferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false);
      }}
      onPress={onPress}
      style={[styles.tile, focused && styles.tileFocused]}
    >
      <Feather
        name={icon}
        size={30}
        color={focused ? colors.foreground : colors.brand}
      />
      <View style={styles.tileCopy}>
        <Text style={styles.tileLabel}>{label}</Text>
        {count !== undefined ? (
          <Text style={styles.tileCount}>
            {count} {count === 1 ? "item" : "items"}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const TILE_HEIGHT = 108;

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: spacing.screen,
  },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
  },
  tiles: { flexDirection: "row", gap: spacing.md },
  tile: {
    flex: 1,
    height: TILE_HEIGHT,
    justifyContent: "space-between",
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  // Opaque brand fill: the glow renders through a translucent one (see theme).
  tileFocused: {
    backgroundColor: colors.brandSoftSolid,
    borderColor: colors.ring,
    shadowColor: colors.brand,
    shadowOpacity: focus.shadowOpacity,
    shadowRadius: focus.shadowRadius,
    shadowOffset: focus.shadowOffset,
    elevation: focus.elevation,
    transform: [{ scale: focus.scale }],
  },
  tileCopy: { gap: 2 },
  tileLabel: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  tileCount: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
