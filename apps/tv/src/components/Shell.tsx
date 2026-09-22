import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Linking, StyleSheet, View } from "react-native";
import { CardMenuProvider } from "@/components/CardMenu";
import {
  EXPANDED_WIDTH,
  RAIL_WIDTH,
  type Section,
  Sidebar,
} from "@/components/Sidebar";
import { parseDeepLink } from "@/lib/deep-links";
import { useLongSelectDispatcher } from "@/lib/long-press";
import type { Nav, OpenVideoOptions, PlayContext } from "@/lib/navigation";
import { loadSidebarPrefs } from "@/lib/sidebar-prefs";
import { trpcClient } from "@/lib/trpc";
import { useTvRemoteReceiver } from "@/lib/tv-remote";
import { useResumeLookup, useWatchProgressRefresh } from "@/lib/watch-progress";
import { ChannelScreen } from "@/screens/ChannelScreen";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { PlaylistsScreen } from "@/screens/PlaylistsScreen";
import { QueueScreen } from "@/screens/QueueScreen";
import { RecommendedScreen } from "@/screens/RecommendedScreen";
import { SavedScreen } from "@/screens/SavedScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SubscriptionsScreen } from "@/screens/SubscriptionsScreen";
import { TrendingScreen } from "@/screens/TrendingScreen";
import { WatchScreen } from "@/screens/WatchScreen";
import { colors, spacing } from "@/theme";

/**
 * 10-foot app shell: a left nav over section screens, plus a small route stack
 * for watch/channel overlays. No navigation library — a section is the base and
 * watch/channel push onto a stack that remote Back pops (exits at the root).
 */
type Route =
  | {
      name: "watch";
      videoId: string;
      resumeSeconds?: number;
      context?: PlayContext;
    }
  | { name: "channel"; channelId: string };

export function Shell({
  onSignOut,
  onChangeServer,
}: {
  onSignOut: () => void;
  onChangeServer: () => void;
}) {
  useLongSelectDispatcher();
  const [section, setSection] = useState<Section>("home");
  const [stack, setStack] = useState<Route[]>([]);
  const [searchQuery, setSearchQuery] = useState<string | undefined>(undefined);
  const [sections, setSections] = useState<Section[] | undefined>(undefined);
  /**
   * The rail overlays the screen, so an expanded rail used to cover the content
   * beside it — most visibly the Subscriptions channel list. Shift the content
   * by the same amount instead, so both stay fully visible.
   */
  const contentInset = useRef(new Animated.Value(RAIL_WIDTH)).current;
  const onSidebarExpanded = useCallback(
    (expanded: boolean) => {
      // One value drives both the rail's width and the content's inset, so
      // they can never be at different widths. It jumps rather than animates:
      // a margin can't run on the native driver, and tweening it relaid out
      // the whole screen (every mounted shelf and card) on each frame, which
      // stalled the JS thread and made the D-pad feel sticky at the rail.
      contentInset.setValue(expanded ? EXPANDED_WIDTH : RAIL_WIDTH);
    },
    [contentInset],
  );

  useEffect(() => {
    loadSidebarPrefs().then((prefs) => setSections(prefs.order));
  }, []);
  const top = stack[stack.length - 1];

  const lookupResume = useResumeLookup();
  const refreshProgress = useWatchProgressRefresh();

  // Callers that know a position (History) pass one; everything else
  // resumes from the stored watch position, like the web app.
  const watchRoute = useCallback(
    (videoId: string, options?: OpenVideoOptions): Route => ({
      name: "watch",
      videoId,
      resumeSeconds: options?.resumeSeconds ?? lookupResume(videoId),
      context: options?.context,
    }),
    [lookupResume],
  );

  /**
   * Next/previous within a play context swaps the video in place, so Back
   * still returns to wherever playback started rather than stepping back
   * through every video watched since.
   */
  const replaceVideo = useCallback(
    (videoId: string, options?: OpenVideoOptions) => {
      setStack((s) => [...s.slice(0, -1), watchRoute(videoId, options)]);
    },
    [watchRoute],
  );

  const nav: Nav = useMemo(
    () => ({
      openVideo: (videoId, options) =>
        setStack((s) => [...s, watchRoute(videoId, options)]),
      openChannel: (channelId) =>
        setStack((s) => [...s, { name: "channel", channelId }]),
    }),
    [watchRoute],
  );

  /**
   * Choosing a section has to drop any watch/channel overlay: the overlay wins
   * over `section` when rendering, so without this the sidebar appears dead
   * while a channel page is open.
   */
  const selectSection = useCallback(
    (next: Section) => {
      setSection(next);
      setStack([]);
      refreshProgress();
    },
    [refreshProgress],
  );

  const pop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    refreshProgress();
  }, [refreshProgress]);

  /**
   * A video arriving from outside (a deep link, Play on TV) replaces the one
   * playing, or opens over whatever is on screen.
   */
  const topRef = useRef(top);
  topRef.current = top;
  const playFromOutside = useCallback(
    (videoId: string, resumeSeconds?: number) => {
      if (topRef.current?.name === "watch") {
        replaceVideo(videoId, { resumeSeconds });
      } else {
        nav.openVideo(videoId, { resumeSeconds });
      }
    },
    [nav, replaceVideo],
  );
  useTvRemoteReceiver(playFromOutside);

  /**
   * Deep links: owntube:// URLs (the Android TV home screen's Watch Next row,
   * system voice search — MainActivity rewrites ACTION_SEARCH into
   * `owntube://search?q=…`, see plugins/with-tv-search) and the YouTube URLs
   * the "Open with" chooser hands over. See lib/deep-links.
   */
  const handleLinkRef = useRef<(url: string | null) => void>(() => {});
  handleLinkRef.current = (url: string | null) => {
    const link = url ? parseDeepLink(url) : null;
    if (!link) return;
    switch (link.kind) {
      case "search":
        setSearchQuery(link.query);
        setSection("search");
        setStack([]);
        return;
      case "watch":
        playFromOutside(link.videoId, link.startSeconds);
        return;
      case "channel":
        nav.openChannel(link.channelId);
        return;
      case "playlist":
        trpcClient.channel.ytPlaylist
          .query({ playlistId: link.playlistId })
          .then((playlist) => {
            const first = playlist.videos[0];
            if (!first) return;
            nav.openVideo(first.videoId, {
              context: {
                source: "playlist",
                label: playlist.title,
                videos: playlist.videos,
              },
            });
          })
          .catch(() => {});
        return;
    }
  };
  // Once: the launch URL must not be handled again on a re-render.
  useEffect(() => {
    const handle = (url: string | null) => handleLinkRef.current(url);
    Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const sub = Linking.addEventListener("url", (event) => handle(event.url));
    return () => sub.remove();
  }, []);

  /**
   * Back unwinds one step at a time, innermost first. Screens that hold their
   * own transient state (the player's controls, the subscriptions tag submenu)
   * register their own handler and consume the press before this runs — React
   * Native invokes handlers in reverse registration order, so a mounted screen
   * is always asked first.
   *
   * Here that leaves: overlay (watch/channel) → section → Home → exit. Leaving
   * from a section via Home rather than straight out means Back is never one
   * press away from quitting except at the top level.
   */
  //
  // Registered once, reading state through refs: re-registering on every stack
  // change made this the newest handler — after the watch screen's own, which
  // registers as it mounts — so Back skipped the player's dismiss-controls step.
  const backStateRef = useRef({ depth: stack.length, section, pop });
  backStateRef.current = { depth: stack.length, section, pop };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const { depth, section, pop } = backStateRef.current;
      if (depth > 0) {
        pop();
        return true;
      }
      if (section !== "home") {
        setSection("home");
        return true;
      }
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  if (top?.name === "watch") {
    // Keyed so each video gets a fresh player and state: its predecessor's
    // unmount records that video's progress, and nothing carries over.
    return (
      <WatchScreen
        key={`${stack.length}:${top.videoId}`}
        videoId={top.videoId}
        resumeSeconds={top.resumeSeconds}
        context={top.context}
        onOpenVideo={nav.openVideo}
        onReplaceVideo={replaceVideo}
        onOpenChannel={nav.openChannel}
        onBack={pop}
      />
    );
  }
  const body =
    top?.name === "channel" ? (
      <ChannelScreen channelId={top.channelId} nav={nav} />
    ) : section === "home" ? (
      <HomeScreen nav={nav} />
    ) : section === "search" ? (
      <SearchScreen nav={nav} initialQuery={searchQuery} />
    ) : section === "recommended" ? (
      <RecommendedScreen nav={nav} />
    ) : section === "saved" ? (
      <SavedScreen nav={nav} />
    ) : section === "trending" ? (
      <TrendingScreen nav={nav} />
    ) : section === "subscriptions" ? (
      <SubscriptionsScreen nav={nav} />
    ) : section === "settings" ? (
      <SettingsScreen
        onSidebarChange={setSections}
        onSignOut={onSignOut}
        onChangeServer={onChangeServer}
      />
    ) : section === "playlists" ? (
      <PlaylistsScreen nav={nav} />
    ) : section === "queue" ? (
      <QueueScreen nav={nav} />
    ) : (
      <HistoryScreen nav={nav} />
    );

  // Content reserves the collapsed rail as a left margin; the sidebar overlays
  // the content (absolute) and expands rightward over it when focused.
  return (
    <CardMenuProvider nav={nav}>
      <View style={styles.shell}>
        <Animated.View style={[styles.content, { marginLeft: contentInset }]}>
          {body}
        </Animated.View>
        <Sidebar
          active={section}
          onSelect={selectSection}
          sections={sections}
          onExpandedChange={onSidebarExpanded}
          width={contentInset}
        />
      </View>
    </CardMenuProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1,
    paddingVertical: spacing.screen,
    paddingRight: spacing.screen,
    paddingLeft: spacing.lg,
  },
});
