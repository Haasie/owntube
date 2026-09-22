# OwnTube TV (`apps/tv`)

Android TV / Fire TV lean-back client for OwnTube. It is a **thin consumer** of the web app's
`AppRouter` over tRPC and has no backend of its own. Built with Expo SDK 52 +
`react-native-tvos` 0.76; playback is ExoPlayer through `expo-video`.

Roadmap: [`docs/TV-PARITY-PLAN.md`](../../docs/TV-PARITY-PLAN.md).

## What it does

- **Sign-in** by device pairing (code + QR, approved from the web app), with email + password as
  a fallback. An expired session returns to sign-in.
- **Sections** in a D-pad sidebar (order editable in Settings): Home (hero + rows), Subscriptions
  (with tags), Recommended, Search (text and voice, plus the Android TV global search intent via
  `plugins/with-tv-search.js`), Queue, Playlists, History, Settings. Channel pages open from any
  card.
- **Player**: server DASH (`/dash/<id>/manifest.mpd`) with muxed fallbacks, live via
  `/dash/<id>/live.mpd`, audio language, subtitles, chapters, storyboard scrubbing, SponsorBlock
  auto-skip (categories from the user's settings) and resume/watch progress.

Settings shared with the web (playback quality, SponsorBlock, …) are read from and written to
`settings.*` on the server; device-only preferences (sidebar order) stay in SecureStore.

## Install and typecheck

`apps/tv` is **not** in the pnpm workspace: Expo 52 needs React 18, which conflicts with the web
app's React 19. It installs on its own:

```bash
cd apps/tv
pnpm install --ignore-workspace --shamefully-hoist   # corepack pnpm 9.15.9
pnpm run typecheck
```

`--shamefully-hoist` is required: Metro expects a flat `node_modules` and resolves transitive
runtime deps from the top level (pnpm ≥ 10 ignores the `.npmrc` key, so pass the flag).

The typecheck resolves `@web/*` (`../web/src/*`), so the web app's deps must be installed too. Most
`@web` imports are `import type` (the `AppRouter`, `UnifiedVideo`) and are erased by Babel; the
few runtime ones (`@web/lib/video-chapters`, `video-scrub-frames`, `query-retry`,
`action-icon-paths`) must stay free of server code and heavy deps such as zod.

## Build

The server URL is baked in at build time from `EXPO_PUBLIC_OWNTUBE_URL` (default
`http://10.0.2.2:3000`, the host as seen from the emulator).

```bash
EXPO_PUBLIC_OWNTUBE_URL=https://owntube.example.org CI=1 pnpm run prebuild   # EXPO_TV=1 expo prebuild
cd android
EXPO_PUBLIC_OWNTUBE_URL=https://owntube.example.org NODE_ENV=production \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon
# → android/app/build/outputs/apk/release/app-release.apk (debug-signed for now)
```

- `EXPO_TV=1` (set by the `prebuild`/`android` scripts) makes `@react-native-tvos/config-tv`
  generate a TV build.
- Gradle does not track `EXPO_PUBLIC_*`: after changing only the URL, delete
  `app/build/generated/{assets,res}/createBundleReleaseJsAndAssets` or the old URL stays in the
  bundle.
- RN 0.76 needs NDK 26.1 (`ndk;26.1.10909125`) and SDK 35 (`platforms;android-35`,
  `build-tools;35.0.0`).
- For development against Metro instead: `pnpm run android`.

The Android toolchain does not need to be installed on the host: the
`reactnativecommunity/react-native-android` Docker image works, with the repo copied (not
bind-mounted, if it is not writable by the container user) and the SDK, Gradle cache and pnpm
store on volumes.

## Test on the emulator

```bash
yes | sdkmanager "emulator" "system-images;android-34;android-tv;x86"
echo no | avdmanager create avd -n tv -k "system-images;android-34;android-tv;x86" -d tv_1080p
emulator -avd tv -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect &
adb wait-for-device && adb shell getprop sys.boot_completed      # wait for "1"

adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell monkey -p com.mdbraber.owntube.tv -c android.intent.category.LEANBACK_LAUNCHER 1
adb shell input keyevent DPAD_DOWN        # UP / LEFT / RIGHT / CENTER / BACK
adb exec-out screencap -p > shot.png
adb logcat -d -s ReactNativeJS:V ExoPlayerImpl:V AndroidRuntime:E
```

- The API 34 TV image is **x86 only** (no x86_64): build with `-PreactNativeArchitectures=x86`
  for the emulator.
- The emulator needs `/dev/kvm` access (in a container: `--device /dev/kvm` and a user that can
  open it).
- Sign in by reading the pairing code off a screenshot and approving it at `/tv/pair` on the web
  app (codes expire after 10 minutes; relaunch for a fresh one).

## Monorepo / Metro notes

- `metro.config.js` watches the workspace root and resolves from both `apps/tv/node_modules` and
  the root `node_modules`. If a module fails to resolve, start here.
- `unstable_enablePackageExports` is on because some deps (e.g. `copy-anything` via superjson)
  are exports-only.
