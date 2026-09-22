# OwnTube TV ↔ web / YouTube TV parity: phased plan

Status: **not started.** Written 2026-09-22.

| phase | state | commits |
|---|---|---|
| 0 — groundwork (docs, deps, dead code) | not started | — |
| 1 — lean-back playback (up next, queue/playlist play, continue watching) | not started | — |
| 2 — player controls (quality, captions, speed, subscribe, save-to) | not started | — |
| 3 — browsing (home blocks, search, channels, library editing) | not started | — |
| 4 — distribution (server URL, versioning, updates, CI) | not started | — |
| 5 — Android TV platform (Watch Next, deep links, Send to TV) | not started | — |
| 6 — depth (description/comments, live polish, Shorts, profiles) | not started | — |

Already shipped before this plan: device pairing, session-expiry → sign-in
and Search D-pad focus (`f051369`), faster browsing and playback in `Shell`,
`VideoRow`, `CarouselFeed`, `HomeScreen` and `WatchScreen` (`fffcb77`), Back
in the player hiding the controls first (`b88b313`), pairing-code
auto-refresh (`8a8eb0e`) and live via `/dash/<id>/live.mpd` (`8e1a1e1`).
Phase 0 starts from `main` at `8e1a1e1`.

## The question this answers

How far should `apps/tv` go toward the web app and toward the official YouTube
Android TV client, and in what order?

The answer from a feature inventory of both apps: **the TV app is good at
starting a video and weak at everything after it.** It has sign-in, home,
subscriptions with tags, search with voice, channels, history, queue,
playlists, settings, and a player with server DASH, audio language, chapters,
storyboard scrubbing, SponsorBlock and resume. What it lacks is the lean-back
loop (nothing happens when a video ends), most player controls, and every
Android TV platform hook the official client relies on.

Almost all of phases 1–3 is **client-only**: the tRPC procedures already exist
because the web app uses them.

## Non-goals

- **Touch/pointer features from the web:** swipe gestures, quick-action
  registry, mini-player, cinema mode, keyboard shortcuts, bottom-nav editor,
  theme/visual theme, drag reorder. A D-pad needs its own interaction models
  (below), not ports.
- **Editing server-level settings on the TV:** Invidious instances, RSS feeds,
  Takeout/JSON import-export, cache maintenance, taste onboarding. These stay
  web-only; the TV links to them via "Manage on web" (a QR code to the page).
- **Posting comments, live chat.** Read-only at most.
- **YouTube account features** (notifications, memberships, uploads). OwnTube
  has no such concepts.
- **A navigation library.** The `Shell` section + overlay stack is enough;
  phase 1 extends it with a "play context" rather than replacing it.

## Phase 0 — groundwork

Small, do first, one commit.

- Declare the transitive deps the app imports directly: `expo-keep-awake`,
  `expo-file-system`, `@expo/vector-icons` in `apps/tv/package.json`.
- Rewrite `apps/tv/README.md` (it still says "Phase 1 scaffold, not yet
  runtime-verified"); link the build/test recipe (Docker + emulator).
- Fix stale comments: `LoginScreen.tsx` ("pairing replaces this later"),
  `WatchScreen.tsx` `pickDefaultOptionIndex` doc ("HLS wins"; DASH is first).
- Remove the dead `src/lib/use-query.ts` hook; move `errorMessage` to its own
  module.
- Honour `settings.sponsorBlockCategories` instead of the hardcoded category
  list in `WatchScreen`. This is a bug, not a feature.

## Phase 1 — lean-back playback

The highest-value phase: it turns "open a video" into "watch TV".

### 1.1 Play context

Introduce a play context on the `watch` route:

```ts
type PlayContext =
  | { kind: "single" }
  | { kind: "queue" }                         // queue.listDetailed order
  | { kind: "playlist"; playlistId: string } // playlists.itemsDetailed order
  | { kind: "feed"; videoIds: string[] };     // the row the video came from
```

`nav.openVideo(videoId, { resumeSeconds, context })`. `WatchScreen` resolves
"next" and "previous" from the context, falling back to `video.related[0]`
for `single`.

### 1.2 Up next / autoplay

- Read `settings.autoplayNext` (currently fetched but never used on TV).
- On `playToEnd`: show an end screen with the next item and a 10 s countdown,
  "Play now" (focused) and "Cancel". Counting down only when `autoplayNext` is
  on; otherwise the card waits for OK.
- Remote `MEDIA_NEXT` / `MEDIA_PREVIOUS` (and long-press right/left at the
  end of the bar) move within the context.
- When the context is `queue`, remove the finished item (`queue.remove`),
  matching the web queue's consume behaviour. Check the web first; if it keeps
  items, keep them here too.

### 1.3 Play all

"Play all" buttons on `QueueScreen` and `PlaylistsScreen` start the context at
item 0 (or at the first unfinished item, using `history.progressAll`).

### 1.4 Continue watching

A row at the top of `HomeScreen`: videos from `history.progressAll` with
5 % < progress < 90 %, newest first, opened with their resume position. No
new procedure; `watch-progress.tsx` already loads the data.

**Verify:** on the emulator, play a 2-item playlist to the end with autoplay on
and off; next/previous keys; queue item consumed; continue-watching row
updates after backing out mid-video.

## Phase 2 — player controls

One **player settings panel** (opened with a gear button, or with DOWN from
the control row) instead of cycling buttons. Rows: Quality, Captions, Audio
language, Speed, Stats. Each row opens a vertical list; Back closes.

- **Quality.** Offer the DASH representations ExoPlayer exposes (expo-video
  `availableVideoTracks` / `videoTrack`, if the installed expo-video version
  supports it). Otherwise offer the existing source options (DASH Auto, muxed
  heights). Apply `defaultPlaybackQuality` as a max-height cap on the DASH
  source so the setting finally does something.
- **Captions.** List all subtitle tracks by language; remember the choice
  (local per-device, like the web's `player-captions` storage). Add a
  caption-size preference (S/M/L) if expo-video exposes styling; otherwise skip.
- **Audio language.** Move the globe cycle button into the panel as a list.
- **Speed.** 0.5–2× (same steps as the web's `player-constants.ts`).
- **Stats for nerds** (cheap and useful for debugging on real TVs): source id,
  resolution, codec, dropped frames, buffer.
- **Subscribe** button in the player's channel row (`subscriptions.status` /
  `add` / `remove`; copy the optimistic pattern from `ChannelScreen`).
- **Save to playlist** dialog: `playlists.list`, `playlists.membership`,
  `addItem` / `removeItem`, plus "New playlist" through `playlists.create`
  with a text field.
- **SponsorBlock UX:** a "Skipped: Sponsor" toast with a 5 s "Undo"; a
  "Skip sponsor" button when auto-skip is off; segment marks on the seek bar
  (the chapter tick renderer already exists).
- **Chapters list:** a panel row listing chapters; OK seeks.
- **Mark as watched** (`history.upsertEvent` completed / `subscriptions.markWatched`).

**Verify:** each panel row reachable and escapable with the D-pad only; the
quality choice survives a source fallback; captions choice persists across
videos.

## Phase 3 — browsing parity

- **Home from `settings.homeBlocks`.** Render the same blocks the web user
  configured (subscriptions, recommended, explore/trending, history, queue,
  saved, playlists, single playlist) as rows, keeping the hero on top.
  Unsupported layouts (sizes, rows) map to one row style. The web stays the
  editor; the TV shows a "Customise on web" hint.
- **Search:**
  - Suggestions from `search.suggestions`, shown beside the field and
    updated as you type or dictate.
  - Recent searches, stored locally.
  - Channel results with Subscribe, from the channels part of the web
    search results.
  - Sort by relevance, newest or views.
- **Subscriptions:** page past the 50-channel `listSidebar` cap (use
  `subscriptions.listDetailed`, or add a cursor to `listSidebar`), unsubscribe
  from a channel's context menu, and a new-video dot based on
  `refreshRecency`.
- **Channel tabs:** Videos, Shorts, Playlists and Similar
  (`channel.page` tab, `channel.playlists`, `channel.relatedChannels`), plus
  the tag chips (`channelTags.*`).
- **Library editing.** Add a long-press OK **context menu** as the one
  pattern used everywhere:
  - on a video card: Play, Add to queue, Save, Save to playlist, Mark
    watched, Not interested (`interactions.set` ignore), Go to channel
  - on library screens: Remove, Move up, Move down (`queue.reorder`,
    `playlists.reorderItems`), Clear queue, Remove from history
    (`history.softDelete`)
- **Saved and Trending sections** (`interactions.listSaved`, `trending.list`
  with region), added to the sidebar and to the sidebar editor.

**Verify:** a web user's `homeBlocks` changes show up on the TV after a
refresh; the context menu works on every card type; more than 50
subscriptions are reachable.

## Phase 4 — distribution

Needed before the APK can go to anyone else.

- **Server URL setting:**
  - A first-run "Server" screen before sign-in, with a text field, an
    `auth.session` health check, and the value saved in SecureStore.
  - `config.ts` reads the stored URL first and falls back to
    `EXPO_PUBLIC_OWNTUBE_URL`.
  - Changing the server signs out.
  - Settings gets "Server: <url> · Change".
- **Versioning:**
  - `version` / `android.versionCode` in `app.json`, bumped per release.
  - Settings shows the version, build and server.
- **Updates:** either expo-updates (OTA JS updates served by OwnTube itself,
  e.g. `/tv/updates`) or a simpler "new APK available" check against a JSON
  file on the server plus a download link or QR code. Start with the
  simple check.
- **Release signing:** a real keystore (not the debug key) kept outside the
  repo; document it in the README.
- **CI:** a job that installs `apps/tv` on its own, typechecks with the web
  types resolvable, and runs `assembleRelease` for `arm64-v8a,armeabi-v7a`,
  uploading the APK as an artifact.

## Phase 5 — Android TV platform

Where the official client is strongest. Each item is a config plugin or small
native module, following the pattern of `plugins/with-tv-search.js`.

- **Deep links:**
  - `owntube://watch?v=<id>&t=<s>` and `owntube://channel/<id>`.
  - youtube.com / youtu.be / m.youtube.com intent filters (the "open with"
    chooser), mapped the same way the web middleware maps YouTube URLs.
  - Handled in `Shell` next to the existing `owntube://search`.
- **Watch Next row** (Android TV home screen "Continue watching"): publish
  in-progress videos to `TvContractCompat.WatchNextPrograms` on progress and
  exit, and remove them on completion. It needs a small Kotlin module
  (androidx.tvprovider); the deep link above is the program intent.
- **Home screen channel** (optional): a "Subscriptions" preview channel
  refreshed on app start.
- **MediaSession metadata:** title, channel and artwork on the now-playing
  card and for Assistant ("pause", "skip 30 seconds"). Check what expo-video
  already sets; add the metadata if it's missing.
- **Send to TV** (the OwnTube equivalent of casting / "Link with TV code"):
  - Server: a `remote` channel keyed by user and device (device id taken
    from the pairing token), with procedures `devices.list` and
    `remote.sendToDevice(videoId, t)`.
  - TV: poll every 2 s while in the foreground, as pairing already does, or
    use SSE if the tRPC setup allows it. Open the video with its context.
  - Web: a "Play on TV" button on `/watch` when the user has a paired device.
  - This is the only phase-5 item that needs backend work.

## Phase 6 — depth

- **Description and comments panel** on the watch screen (`video.detail`
  description, `video.comments` top/new with paging). Read-only and
  focusable, with D-pad scrolling.
- **Live polish:**
  - A LIVE badge.
  - "Go to live" when 15 s or more behind the edge, matching the web's
    threshold.
  - Seeking within the DVR window.
  - Post-live DVR through the `/dash` fallback, as on the web.
  - Upcoming-stream state with the start time.
- **Error states:** age-restricted, unavailable and upcoming, each with a
  retry button, mirroring the web's watch page.
- **Shorts:**
  - A vertical player where up/down moves between shorts.
  - Feeds from `shorts.feed`, with `shorts.markSeen` for seen-tracking.
  - A Shorts row on Home when the web home has the shelf.
- **Profiles ("Who's watching"):** keep several paired accounts on one TV
  (a token per profile) and switch between them from Settings or at start.
- **Recommendation feedback:** "Not interested" and "Don't recommend
  channel" (`interactions.set` ignore, `blockRecommendationChannel`).

## Cross-cutting rules

- **D-pad first.** Every new surface must be fully usable with arrows, OK
  and Back, and Back always closes the innermost layer. Test each surface on
  the emulator before committing.
- **Text inputs** use `FocusableTextInput`. A bare `TextInput` cannot take
  D-pad focus on Android.
- **Server truth:** settings changed on the TV go through `settings.update`,
  so the web and TV stay the same. Device-local choices (sidebar order,
  caption language, recent searches) stay in SecureStore or local storage.
- **Mirror, don't fork, policy:** reuse `@web/lib/*` helpers (chapters, scrub
  frames, quality labels, short detection) as `WatchScreen` already does,
  rather than reimplementing them.
- **Verification per phase:** typecheck (compare against the known `@web`
  baseline errors), `biome check`, release build, and install and drive it on
  the Android TV emulator with screenshots.

## Rough sizing

| phase | size | backend changes |
|---|---|---|
| 0 | S (½ day) | none |
| 1 | M (2–3 days) | none |
| 2 | M–L (3–4 days) | none |
| 3 | L (4–5 days) | maybe a cursor on `listSidebar` |
| 4 | M (2–3 days) | optional update manifest |
| 5 | L (4–6 days) | Send to TV (`remote`/device procedures) |
| 6 | L (5+ days) | none |

Phases 1 and 2 give the largest user-visible improvement per day. Phase 4
blocks sharing the app with anyone else; do it before phase 5 if that matters
sooner.
