import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import {
  channelInitial,
  formatPublishedLabel,
  formatThumbnailBadge,
  formatViews,
  videoThumbnailUrl,
} from "@/lib/format";
import { colors, fontSize, spacing } from "@/theme";

export type SpotlightItem = {
  video: UnifiedVideo;
  /** Where it came from: "Top pick for you", "Continue watching"… */
  label: string;
};

/** The backdrop's blur, in Android's Image blurRadius units. */
const BLUR = 22;
/** How long a new backdrop takes to fade over the old one. */
const FADE_MS = 350;

/**
 * Home's header: the focused card's title, channel and metadata over a
 * blurred still of that video, changing as focus moves along the rows — the
 * Plex client's home. It replaces the old static hero, which sat above the
 * rows and got sliced whenever a row took focus.
 *
 * Not focusable: the card is what you press. The backdrop is drawn by the
 * page behind everything (see `SpotlightBackdrop`), this is the text.
 */
export function Spotlight({ item }: { item: SpotlightItem }) {
  const { video, label } = item;
  const views = formatViews(video.viewCount);
  const published = formatPublishedLabel(
    video.publishedText,
    video.publishedAt,
  );
  const badge = formatThumbnailBadge(video);
  const metadata = [views, published, badge].filter(Boolean).join(" · ");

  return (
    <View style={styles.header}>
      <View style={styles.pill}>
        <View style={styles.pillDot} />
        <Text style={styles.pillText} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {video.title}
      </Text>
      <View style={styles.metaRow}>
        {video.channelAvatarUrl ? (
          <Image
            source={{ uri: video.channelAvatarUrl }}
            style={styles.avatar}
            resizeMethod="resize"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {channelInitial(video.channelName)}
            </Text>
          </View>
        )}
        <Text style={styles.channel} numberOfLines={1}>
          {video.channelName ?? ""}
        </Text>
        {metadata ? (
          <Text style={styles.metadata} numberOfLines={1}>
            {metadata}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Steps of the fade over the rows; RN has no gradients without a native module. */
const FADE_BANDS = ["a", "b", "c", "d", "e", "f", "g", "h"];
/** Where the fade starts, as a share of the page's height. */
const FADE_FROM = 0.3;

/**
 * The blurred still behind a page. A new video's still fades in over the
 * previous one, so moving along a row doesn't flash. Drawn twice on Home:
 * once behind the whole page, dimmed and fading out toward the bottom so the
 * rows stay readable, and once inside the sticky header, so the rows that
 * scroll under it are hidden without the header going flat.
 */
export function SpotlightBackdrop({
  video,
  variant,
}: {
  video: UnifiedVideo;
  variant: "page" | "header";
}) {
  const uri = videoThumbnailUrl(video);
  const [layers, setLayers] = useState<{ key: number; uri: string }[]>([
    { key: 0, uri },
  ]);
  const nextKey = useRef(1);
  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1]?.uri === uri) return prev;
      // Two at most: the one fading out and the one fading in.
      return [...prev.slice(-1), { key: nextKey.current++, uri }];
    });
  }, [uri]);
  const settle = (key: number) =>
    setLayers((prev) => {
      const index = prev.findIndex((l) => l.key === key);
      return index > 0 ? prev.slice(index) : prev;
    });

  return (
    <View style={styles.backdrop} pointerEvents="none">
      {layers.map((layer, index) => (
        <FadingStill
          key={layer.key}
          uri={layer.uri}
          fade={index > 0}
          onSettled={() => settle(layer.key)}
        />
      ))}
      <View style={styles.scrim} />
      {variant === "page"
        ? FADE_BANDS.map((band, index) => (
            <View
              key={band}
              style={[
                styles.band,
                {
                  top: `${(FADE_FROM + ((1 - FADE_FROM) * index) / FADE_BANDS.length) * 100}%`,
                  backgroundColor: `rgba(10,10,12,${(0.11 * (index + 1)).toFixed(2)})`,
                },
              ]}
            />
          ))
        : null}
    </View>
  );
}

function FadingStill({
  uri,
  fade,
  onSettled,
}: {
  uri: string;
  fade: boolean;
  onSettled: () => void;
}) {
  const opacity = useRef(new Animated.Value(fade ? 0 : 1)).current;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!fade || !loaded) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => finished && onSettled());
  }, [fade, loaded, opacity, onSettled]);
  return (
    <Animated.Image
      source={{ uri }}
      blurRadius={BLUR}
      resizeMode="cover"
      onLoad={() => setLoaded(true)}
      style={[styles.still, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, maxWidth: 700, minHeight: 132 },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  pillText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "800",
    lineHeight: 34,
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.avatarFallback,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  avatarInitial: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "800",
  },
  channel: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: "700",
    flexShrink: 1,
  },
  metadata: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: colors.background,
  },
  still: {
    ...StyleSheet.absoluteFillObject,
    // Larger than the page so the blur's soft edge lands outside it.
    margin: -40,
    opacity: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,12,0.6)",
  },
  // Each band runs from its top to the bottom edge, so the dims stack up.
  band: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
