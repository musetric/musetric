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
  Musetric Dev; only a release build with `MUSETRIC_PUBLISH=true`, which
  `appBuild.yml` sets in its release and testing modes, is `com.musetric.client`
  named Musetric. The two install side by side, each with its own data, and on
  Android only the development build's WebView can be inspected. The Tauri CLI
  sets the identifier itself: on Android it writes the debug suffix from
  `debugApplicationIdSuffix` of `tauri.android.conf.json` and starts the app by
  it, and on iOS it takes `identifier` from `gen/apple/identity.conf.json`,
  which `initNative.ts` writes and `yarn dev:ios` and `yarn build:ios` pass
  with `--config`.
- `native/apple/PrivacyInfo.xcprivacy` gives the reason for every required
  reason API the iOS binary calls, now file timestamps and disk space: App Store
  Connect refuses a build that calls one without its reason.
- `appBuild.yml` numbers an iOS build 1000 plus its run number, since App Store
  Connect refuses a build number it already has. In the testing mode a job of
  its own signs the build and uploads it to TestFlight once the owner approves
  the run in the `app-store` environment; it runs none of the project's code.
- Delete the platform directory under `src-tauri/gen` after an interrupted
  generator run, a Tauri CLI update or a branch with extra overlay files.
- Both windows load from the embedded host over the loopback address
  (`WebviewUrl::External` in `src-tauri/src/lib.rs`): the page has no Tauri IPC.
- `src/favicon.svg` is the only icon source, of the app and of the page.
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
  version 26, `minSdk` of `native/android/app/build.gradle.kts` and
  `tauri.android.conf.json` hold Android at version 12, and the Linux build is
  not offered.
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
