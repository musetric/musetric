# @musetric/app

The Musetric application for desktop, Android and iOS. Its Tauri shell links
the shared Rust server and runs the Musetric frontend in a WebView.

## Commands

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `yarn dev:app`       | Runs the Tauri shell                                   |
| `yarn build:app`     | Compiles the shell without packaging it                |
| `yarn init:android`  | Materializes `src-tauri/gen/android`                   |
| `yarn dev:android`   | Runs a connected device against the development server |
| `yarn build:android` | Builds the APK                                         |
| `yarn init:ios`      | Materializes `src-tauri/gen/apple`                     |
| `yarn dev:ios`       | Runs a connected device against the development server |
| `yarn build:ios`     | Builds the app                                         |

`yarn build:android --debug` builds a debuggable APK, the only kind that
`adb shell run-as com.musetric.client` can enter to read or place the app's
files. It keeps the debug symbols of the native libraries and is not minified
(`native/android/app/build.gradle.kts`), so it is larger than the release APK.

## Native projects

`src-tauri/gen` holds the Android Studio and Xcode projects that Tauri
generates, down to the Gradle wrapper and the Xcode project file. None of it is
checked in. `native/android` and `native/apple` carry the handful of files that
differ from that generated output, mirroring the layout they land in.

`init:android` and `init:ios` run the Tauri generator when the platform's
project is missing (`settings.gradle` or `project.yml` under
`src-tauri/gen`), copy the overlay over the result and drop the template files the app
does not use. Both are idempotent, both run ahead of every `dev` and `build`
command, and neither rewrites a file whose content already matches, so Gradle
and Xcode keep their incremental state. Changing `native/apple/project.yml`
reruns XcodeGen.

Change a generated file only through the overlay: the next generator run
overwrites everything else. If a generator run is interrupted, delete the
platform directory under `src-tauri/gen` so the next command regenerates it
from scratch.

Because the generator runs only then (`scripts/initNative.ts`), a generated
project keeps everything the overlay does not carry, the Gradle wrapper and
`buildSrc` among them, from the Tauri CLI that made it, while CI generates a
fresh one on every run. After an update
of the Tauri CLI, delete `src-tauri/gen/android` so the next command takes the
new template. The overlay only adds and overwrites files: of the files it does
not carry, only the template files in `staleFiles` are deleted, so a file left
by the overlay of another branch is still built until the platform directory
is deleted.

## The page and the host

Both windows load from the host the app embeds, over the loopback address
(`WebviewUrl::External` in `src-tauri/src/lib.rs`), not through the Tauri
protocol. On Android that protocol hands every response to the WebView as one
Java byte array (wry builds a `WebResourceResponse` over a
`ByteArrayInputStream`), so a model file of hundreds of megabytes would sit in
the app's Java heap at once.

Loaded from a remote URL that no capability lists
(`src-tauri/capabilities/default.json`), the page has no Tauri IPC. Native
features reach it through bridges of the WebView itself:
`addJavascriptInterface` and `addWebMessageListener` on Android
(`MusetricMedia`, `MusetricSettings`, `MusetricMicrophone`, `MusetricClock`,
and `MusetricThermal` on the executor), `WKScriptMessageHandler` on iOS.

`MusetricMedia` (`MediaSessionBridge.kt`) shows playback in the Android
notification shade. The frontend (`packages/frontend/src/pages/project/mediaSession`)
sends the title, duration, position, playing state and speed when playback
starts or stops, on a seek, on a tempo change and when the position drifts by
more than 0.5 s. `MediaPlaybackService` keeps the notification as a foreground
service of type `mediaPlayback`, and play, pause and seek in the shade come
back to the page as a `musetric:media` window event.

## Data

The app keeps its database, blobs, work files and models in one folder:
`storage/db/app.db`, `storage/blobs`, `storage/work` and `models`
(`src-tauri/src/lib.rs`), and its logs in `logs` on desktop.

| Platform | Folder                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Windows  | `%LOCALAPPDATA%\Musetric`                                                |
| macOS    | `~/Library/Application Support/Musetric`                                 |
| Linux    | `$XDG_DATA_HOME/Musetric`, else `~/.local/share/Musetric`                |
| Android  | `/data/user/0/com.musetric.client`                                       |
| iOS      | `Library/Application Support/com.musetric.client` in the app's container |

A desktop debug build, such as `yarn dev:app`, uses `Musetric Dev` in place of
`Musetric` (`src-tauri/src/lifecycle.rs`); a local release build of
`yarn build:app` opens the installed app's folder, and only one process holds
a folder at a time. `yarn dev` without the app keeps its data in
`packages/server/storage`.

## Icons

`src/favicon.svg` is the only checked-in icon source. `yarn build:icons`
renders it and lets `tauri icon` produce every platform raster asset. Tauri's
`android` and `ios` development and build commands run that step
automatically; the same script also refreshes the Android splash screen
images under `gen/android`. The Vite build renders the page's favicons and
web manifest from the same file.

## Toolchain

Android builds need `ANDROID_HOME`, `NDK_HOME` and JDK 21 in `JAVA_HOME`.
libopus is cross-compiled with CMake, which finds the NDK through
`ANDROID_NDK_HOME`: point it at the same NDK as `NDK_HOME`. On Windows, Ninja
must be on `PATH` too, because the Visual Studio generator cannot target
Android; the Build Tools ship it under
`Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja`.
iOS builds need Xcode, the `aarch64-apple-ios` Rust target, XcodeGen and an
Apple team id in `DEVELOPMENT_TEAM`.

`src-tauri/gen/android/local.properties`, where CI writes `sdk.dir`
(`.github/workflows/appBuild.yml`), is a Java properties file, in which a
backslash is an escape: on Windows, write the path there with forward slashes.

On Windows, the Android NDK linker wrapper can exceed `cmd.exe`'s
command-line limit. Point Cargo at `clang.exe` rather than the `.cmd`
wrapper and pass the Android target explicitly:

```sh
ndk=$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin
export PATH="$ndk:$PATH"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$ndk/clang.exe"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-Clink-arg=--target=aarch64-linux-android24"
```

## Decisions it follows

The owner's decisions this package carries out, kept in
[headquarters](https://github.com/musetric/headquarters/tree/main/decisions):

- Phones process only while the app is on screen ([R-3](https://github.com/musetric/headquarters/blob/main/decisions/r03-phones-process-on-screen.md)).
- The executor is a hidden WebView of the app on every platform, `ExecutorViewPlugin` ([R-4](https://github.com/musetric/headquarters/blob/main/decisions/r04-executor-connects-itself.md)).
- Linux is built but not supported yet ([R-6](https://github.com/musetric/headquarters/blob/main/decisions/r06-linux-not-supported-yet.md)).
- macOS and iOS from version 26, the first whose WKWebView has WebGPU: `minimumSystemVersion` of `tauri.macos.conf.json` and `tauri.ios.conf.json` ([R-40](https://github.com/musetric/headquarters/blob/main/decisions/r40-apple-from-version-26.md)).
- Pull requests do not build the app; a release run checks the installed app ([R-12](https://github.com/musetric/headquarters/blob/main/decisions/r12-app-checked-at-release.md)).
