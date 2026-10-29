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
- Delete the platform directory under `src-tauri/gen` after an interrupted
  generator run, a Tauri CLI update or a branch with extra overlay files.
- Both windows load from the embedded host over the loopback address
  (`WebviewUrl::External` in `src-tauri/src/lib.rs`): the page has no Tauri IPC.
- `src/favicon.svg` is the only icon source, of the app and of the page.
- It is the shell of [the product](https://github.com/musetric/headquarters/blob/main/product.md#how-it-is-built) on
  [every platform it supports](https://github.com/musetric/headquarters/blob/main/product.md#where-it-runs): the hidden
  executor WebView is `ExecutorViewPlugin`, `minimumSystemVersion` of
  `tauri.macos.conf.json` and `tauri.ios.conf.json` holds Apple systems at
  version 26, and the Linux build is not offered.
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
installed app's folder; one process holds a folder at a time.

## Toolchain

- Android: `ANDROID_HOME`, `NDK_HOME` and `ANDROID_NDK_HOME` at the same NDK,
  JDK 21 in `JAVA_HOME`, and on Windows Ninja on `PATH`.
- Android on Windows: `sdk.dir` in forward slashes, the NDK's LLVM `bin` on
  `PATH`, and its `clang.exe`, not the `.cmd` wrapper, as Cargo's linker for
  `aarch64-linux-android` with `-Clink-arg=--target=aarch64-linux-android24`.
- iOS: Xcode, the `aarch64-apple-ios` Rust target, XcodeGen and an Apple team
  id in `DEVELOPMENT_TEAM`.
