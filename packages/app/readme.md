# @musetric/app

The Musetric application for desktop, Android and iOS: a Tauri shell that
links the shared Rust server and runs the Musetric frontend in a WebView.

## Commands

| Command              | What it does                                                      |
| -------------------- | ----------------------------------------------------------------- |
| `yarn dev:app`       | Runs the Tauri shell                                              |
| `yarn build:app`     | Compiles the shell without packaging it                           |
| `yarn init:android`  | Materializes `src-tauri/gen/android`                              |
| `yarn dev:android`   | Runs a connected device against the development server            |
| `yarn build:android` | Builds the APK; `--debug` builds one `adb shell run-as` can enter |
| `yarn init:ios`      | Materializes `src-tauri/gen/apple`                                |
| `yarn dev:ios`       | Runs a connected device against the development server            |
| `yarn build:ios`     | Builds the app                                                    |

## Rules

- `src-tauri/gen` is generated and untracked: edit only its overlay `native`,
  which `scripts/initNative.ts` copies over it before a mobile `dev` or `build`.
- A mobile build is a development build, `com.musetric.client.dev` named
  Musetric Dev; only a release build with `MUSETRIC_PUBLISH=true` is
  `com.musetric.client` named Musetric. The `prepare` job of `appBuild.yml`
  sets it by name, for the release and testing modes only: any other mode, or
  none, builds Musetric Dev. The two install side by side, each with its own
  data, and on Android only the development build's WebView can be inspected.
  The Tauri CLI sets the identifier itself: on Android it writes the debug
  suffix from `debugApplicationIdSuffix` of `tauri.android.conf.json` and
  starts the app by it, and on iOS it takes `identifier` from
  `gen/apple/identity.conf.json`, which `initNative.ts` writes and
  `yarn dev:ios` and `yarn build:ios` pass with `--config`.
- `native/apple/PrivacyInfo.xcprivacy` gives the reason for every required
  reason API the iOS binary calls, now file timestamps and disk space: App Store
  Connect refuses a build that calls one without its reason.
- `ITSAppUsesNonExemptEncryption: false` in `native/apple/project.yml` answers
  the export compliance questions of App Store Connect for every build: the app
  uses standard encryption, rustls for HTTPS, and is not distributed in France.
  Encryption of its own or distribution in France changes the answer.
- `appBuild.yml` is the one workflow of the app build: it takes the mode, sets
  the version and `MUSETRIC_PUBLISH`, builds every platform and publishes the
  GitHub release. The steps of each job live in a composite action of
  `.github/actions`: `appBuildDesktop`, `appBuildAndroid`, `appBuildIos`,
  `appBuildMacAppStore`, `uploadTestflight`, `uploadTestflightMacos` and
  `uploadGooglePlay`. It numbers every iOS, Mac App Store and Android build
  1000 plus its run number, since App Store Connect and Google Play refuse a
  number they already have.
  In the testing mode jobs of their own sign the iOS build, the macOS build for
  the Mac App Store and the Android App Bundle and upload them to TestFlight and
  to Google Play internal testing once the owner approves the run in the
  `app-store` and `google-play` environments; they check out only
  `.github/actions` and run none of the project's code. The macOS build is
  signed into the App Sandbox with `src-tauri/macAppStore.entitlements` and
  packaged as an installer the Mac Installer Distribution certificate signs. The Google Play job signs in to Google Cloud through
  Workload Identity Federation, so its service account has no key.
- On Windows `appBuild.yml` also packs the app as an MSIX for the Microsoft
  Store with `scripts/packMsix.ts`: `makeappx` of the Windows SDK puts the
  app, its notices and its logos under `src-tauri/windows/AppxManifest.xml`,
  whose identity is the app's record in Partner Center. The package goes
  unsigned, since the Store signs it, and its version is the major and minor
  version of `package.json` with 1000 plus the run number. Started from a
  package, from under `WindowsApps`, the app runs no updater of its own,
  since the Store updates it. The manifest turns off the redirection of the
  package's writes (`unvirtualizedResources`), so the packaged app keeps its
  data in `%LOCALAPPDATA%\Musetric` as the NSIS build does; Windows would
  otherwise move a folder it creates there into the package. `buildIcons.ts`
  draws the taskbar logos unplated, which `makepri` indexes in
  `resources.pri`: a plated logo shows the plate in its transparent corners.
- Delete the platform directory under `src-tauri/gen` after an interrupted
  generator run, a Tauri CLI update or a branch with extra overlay files.
- Both windows load from the embedded host over the loopback address
  (`WebviewUrl::External` in `src-tauri/src/lib.rs`): the page has no Tauri IPC.
- Each identity has its own port of the embedded host, so that its page keeps
  one origin and with it its local storage: Musetric listens on 47206, Musetric
  Dev, a desktop debug build included, on 47205. `src-tauri/build.rs` sets the
  `development` cfg by the same rules that pick the identifier and the desktop
  data folder. While another process holds the port, the host takes a free one
  for that run.
- An app in the App Sandbox, as every app of the Mac App Store is, leaves its
  updates to the store and never starts its own updater
  (`APP_SANDBOX_CONTAINER_ID` in `src-tauri/src/update.rs`).
- `src/favicon.svg` is the only icon source, of the app and of the page.
  `yarn build:icons` redraws the iOS icons that `tauri icon` writes as PNG
  without an alpha channel: App Store Connect refuses an app icon with one.
- `yarn build:icons` also writes `gen/AppIcon.icon`, an Icon Composer icon of the same
  background and glyph, and on macOS compiles it into `gen/Assets.car` with `actool`
  from Xcode 26 or later. The macOS bundle lists that `Assets.car` next to
  `icon.icns`: macOS 26 draws a bundle with only the legacy icon on a light plate at
  16 and 32 px. The script runs `actool` itself because the Tauri bundler's own call
  fails on the `.icon` with "Bad file descriptor".
- It is the shell of [the product](https://github.com/musetric/headquarters/blob/main/product.md#how-it-is-built) on
  [every platform it supports](https://github.com/musetric/headquarters/blob/main/product.md#where-it-runs): the hidden
  executor WebView is `ExecutorViewPlugin`, `minimumSystemVersion` of
  `tauri.macos.conf.json` and `tauri.ios.conf.json` holds Apple systems at
  version 26, the macOS app is built for Apple silicon alone, `minSdk` of
  `native/android/app/build.gradle.kts` and `tauri.android.conf.json` hold
  Android at version 12, and the Linux build is not offered.
- Pull requests do not build the app (`.github/workflows/appBuild.yml`); the
  installed app is checked by a [release run](https://github.com/musetric/headquarters/blob/main/practices/release.md).

## Data

| Platform | Folder                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Windows  | `%LOCALAPPDATA%\Musetric`                                                |
| macOS    | `~/Library/Application Support/Musetric`                                 |
| Linux    | `$XDG_DATA_HOME/Musetric`, else `~/.local/share/Musetric`                |
| Android  | `/data/user/0/com.musetric.client`                                       |
| iOS      | `Library/Application Support/com.musetric.client` in the app's container |

The folder holds `storage/db/app.db`, `storage/blobs`, `storage/work`, `models`
and, on desktop, `logs` (`src-tauri/src/lib.rs`). A desktop debug build uses
`Musetric Dev` (`src-tauri/src/lifecycle.rs`), a local `yarn build:app` the
installed app's folder; one process holds a folder at a time. A mobile
development build is an app of its own: on Android its folder is
`/data/user/0/com.musetric.client.dev`, on iOS
`Library/Application Support/com.musetric.client.dev` in its own container.

## Toolchain

- Android: `ANDROID_HOME`, `NDK_HOME` and `ANDROID_NDK_HOME` at the same NDK,
  JDK 21 in `JAVA_HOME`, and on Windows Ninja on `PATH`.
- Android on Windows: `sdk.dir` in forward slashes, the NDK's LLVM `bin` on
  `PATH`, and its `clang.exe`, not the `.cmd` wrapper, as Cargo's linker for
  `aarch64-linux-android` with `-Clink-arg=--target=aarch64-linux-android31`.
- iOS: Xcode, the `aarch64-apple-ios` Rust target, XcodeGen and an Apple team
  id in `DEVELOPMENT_TEAM`.
