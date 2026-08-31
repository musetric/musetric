# @musetric/mobile

The Musetric app for Android and iOS: a Tauri application that runs the
Musetric frontend in a WebView. It opens on the Musetric logo and hands the
screen to React as soon as the bundle loads.

## Inference

The mobile processing queue stores projects behind a token-protected loopback
HTTP server. Browser workers run every production model on WebGPU; model assets
are downloaded on demand from the same pinned, checksummed sources as desktop.
There is intentionally no CPU, WASM, Core ML or native ONNX fallback. If an
Android WebView renderer ends during separation, the isolated GPU renderer is
recreated and processing resumes from persisted state without changing model
runtime.

The measured WebGPU limits and setup notes are in
[`docs/androidWebgpu.md`](docs/androidWebgpu.md) and
[`docs/iosWebgpu.md`](docs/iosWebgpu.md).

## Commands

| Command                      | What it does                                           |
| ---------------------------- | ------------------------------------------------------ |
| `yarn dev:mobile`            | Starts Vite for desktop-browser preview                |
| `yarn build:mobile`          | Creates the WebView bundle                             |
| `yarn init:android`          | Materializes `src-tauri/gen/android`                   |
| `yarn dev:android`           | Runs a connected device against the development server |
| `yarn build:android`         | Builds the APK                                         |
| `yarn init:ios`              | Materializes `src-tauri/gen/apple`                     |
| `yarn dev:ios`               | Runs a connected device against the development server |
| `yarn build:ios`             | Builds the app                                         |
| `yarn check:ios-environment` | Verifies the macOS toolchain required for iOS          |

## Native projects

`src-tauri/gen` holds the Android Studio and Xcode projects that Tauri
generates, down to the Gradle wrapper and the Xcode project file. None of it is
checked in. `native/android` and `native/apple` carry the handful of files that
differ from that generated output, mirroring the layout they land in.

`init:android` and `init:ios` run the Tauri generator when `src-tauri/gen` is
missing, copy the overlay over the result and drop the template files the app
does not use. Both are idempotent, both run ahead of every `dev` and `build`
command, and neither rewrites a file whose content already matches, so Gradle
and Xcode keep their incremental state. Changing `native/apple/project.yml`
reruns XcodeGen.

Change a generated file only through the overlay: the next generator run
overwrites everything else. If a generator run is interrupted, delete the
platform directory under `src-tauri/gen` so the next command regenerates it
from scratch.

## Icons

`src/favicon.svg` is the only checked-in icon source. `yarn build:icons`
renders it and lets `tauri icon` produce every platform raster asset. Tauri's
`android` and `ios` development and build commands run that step
automatically; the same script also refreshes the Android splash screen
images under `gen/android`.

## Toolchain

Android builds need `ANDROID_HOME`, `NDK_HOME` and JDK 21 in `JAVA_HOME`.
iOS builds need Xcode, the `aarch64-apple-ios` Rust target, XcodeGen and an
Apple team id in `DEVELOPMENT_TEAM`.

## Storage

The app stores files under its platform data directory in `storage/db`,
`storage/blobs` and `storage/models`. Large files use the loopback server,
which binds to `127.0.0.1` and prefixes every path with a random token.

On Windows, the Android NDK linker wrapper can exceed `cmd.exe`'s
command-line limit. Point Cargo at `clang.exe` rather than the `.cmd`
wrapper and pass the Android target explicitly:

```sh
ndk=$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin
export PATH="$ndk:$PATH"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$ndk/clang.exe"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-Clink-arg=--target=aarch64-linux-android24"
```
