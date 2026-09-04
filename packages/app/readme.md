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

On Windows, the Android NDK linker wrapper can exceed `cmd.exe`'s
command-line limit. Point Cargo at `clang.exe` rather than the `.cmd`
wrapper and pass the Android target explicitly:

```sh
ndk=$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin
export PATH="$ndk:$PATH"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$ndk/clang.exe"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-Clink-arg=--target=aarch64-linux-android24"
```
