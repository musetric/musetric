# iOS microphone probe

A test build on the branch `probe/ios-microphone-modes`, never merged. After one
build on a Mac, another computer compares the audio session modes of an iPhone
over USB, with no more builds and no taps on the phone.

This file is the task for whoever builds it, most likely a Claude session on the
Mac. Swift could not be compiled where the branch was written, so a compile error
is expected and is yours to fix.

## The task

Build the branch, install it on the connected iPhone, prove it with the checks
below, fix what stops it, and report.

## Limits

- **Never uninstall the app or erase its container.** The iPhone holds real data.
  If the install is refused over a signature or a team, stop and ask the owner.
- Fixes go to this branch as signed commits, titled
  `chore(recording): <subject>`, and are pushed without force. No rebase, no merge
  of `main`, no pull request, no upload to TestFlight or the App Store.
- Fix only what stops the build or the checks. The code of this branch is
  `Sources/MicrophoneProbe.swift` and the lines it adds to
  `Sources/MicrophoneCapture.swift` and `Sources/MicrophonePlugin.swift`. Touch
  anything else only when the build cannot pass otherwise, and say so in the
  report.
- Keep the [protocol](#protocol): the other computer depends on it. When an API
  forces a change, change the code and this file in the same commit.
- The rules of the repository's `AGENTS.md` hold: no comments in code, English
  only. The team id stays in the environment, never in a file or a commit.

## Build

The tools are listed in `packages/app/readme.md`: Xcode, the `aarch64-apple-ios`
Rust target, XcodeGen, Node from `.node-version` and Yarn through corepack.

```sh
git fetch origin
git switch probe/ios-microphone-modes
git pull --ff-only
yarn install --immutable
security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
export DEVELOPMENT_TEAM=<the OU of that subject>
yarn build:ios --export-method debugging
```

If the flag is refused, read `yarn workspace @musetric/app tauri ios build --help`
and take the method that signs for development. The `.ipa` is below
`packages/app/src-tauri/gen/apple/build`.

The build must meet two conditions, or the other computer cannot use it:

- **Signed with Apple Development**, with `get-task-allow` on. Without it the app's
  container cannot be read over USB.
- **Self-contained.** `yarn dev:ios` does not count: its pages come from a
  development server on the Mac, and the iPhone will not stay connected to the Mac.

## Install

```sh
xcrun devicectl list devices
xcrun devicectl device install app --device <id> <path to the .ipa>
xcrun devicectl device process launch --device <id> com.musetric.client
```

Ask the owner to unlock the iPhone when a command needs it. The app must stay in
the foreground for the checks: its timer stops in the background.

## Prove it

Files move with the app's container as the domain. If a flag differs on this Xcode,
read `xcrun devicectl device copy --help`.

```sh
xcrun devicectl device copy from --device <id> \
  --domain-type appDataContainer --domain-identifier com.musetric.client \
  --source Documents/probe/ready.json --destination ready.json
xcrun devicectl device copy to --device <id> \
  --domain-type appDataContainer --domain-identifier com.musetric.client \
  --source request.json --destination Documents/probe/request.json
```

1. **Signature.** Unpack the `.ipa`. `codesign -d --entitlements - Payload/*.app`
   shows `get-task-allow` as true. `security cms -D -i
Payload/*.app/embedded.mobileprovision` gives `ExpirationDate`; put it in the report.
2. **The probe runs.** `Documents/probe/ready.json` exists after the launch.
3. **Measurement mode.** Send `{"id":"smoke-measurement","mode":"measurement","seconds":3}`
   as `request.json`. The first request makes iOS ask for the microphone: the owner
   taps Allow. Poll for `smoke-measurement.json`, which comes about 3 seconds after
   the recording starts. It has no `error`, `frames` is about 3 times
   `formatSampleRate`, and `peak` is above zero. `smoke-measurement.f32` holds
   `frames` times `channels` times 4 bytes.
4. **The mode holds.** Send `{"id":"smoke-voice","mode":"voiceChat","seconds":3}`.
   Both `started.mode` and `ended.mode` read `AVAudioSessionModeVoiceChat`. If `ended`
   reads otherwise, something reset the session during the take: that is a defect
   to fix, because it would make every comparison of modes false.
5. **No development server.** Nothing on the Mac serves the frontend while the app
   loads.
6. **An ordinary recording still works.** Ask the owner to record a few seconds in
   the app. `capture-state.json` then shows `AVAudioSessionModeMeasurement`.

The `smoke-*` files can stay on the phone.

## Report

Tell the owner:

- the commit the installed build came from, and the commits you added;
- the expiry date of the provisioning profile;
- the result of each check, and the `sources` of the built-in microphone from
  `started.inputs` in `smoke-measurement.json`;
- what you changed outside the probe's code, and what you could not verify.

Then ask the owner to plug the iPhone into the computer that runs the measurements
and to leave Musetric open on the screen.

## Protocol

Everything lies in `Documents/probe` in the app's data container. While in the
foreground, the app looks for a request every 0.5 s and keeps the screen on. It
takes no request during an ordinary recording.

| File                 | Written by | Content                                              |
| -------------------- | ---------- | ---------------------------------------------------- |
| `ready.json`         | the app    | The session when the app loaded                      |
| `request.json`       | the caller | One request; the app deletes it when it takes it     |
| `<id>.started.json`  | the app    | `id` and `started`, once the engine runs             |
| `<id>.f32`           | the app    | The input before any processing, interleaved float32 |
| `<id>.json`          | the app    | The result, or `id`, `request` and `error`           |
| `capture.json`       | the caller | `mode` and `inputGain` of an ordinary recording      |
| `capture-state.json` | the app    | The session of the last ordinary recording           |

A request:

| Field             | Value                                                                                                                           | Without it          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `id`              | The name of the files; required                                                                                                 |                     |
| `mode`            | `measurement`, `default`, `voiceChat`, `videoRecording`, `videoChat`, `gameChat`, `spokenAudio`, `voicePrompt`, `moviePlayback` | `measurement`       |
| `category`        | `playAndRecord`, `record`                                                                                                       | `playAndRecord`     |
| `dataSource`      | A `name` from `sources` of the built-in microphone                                                                              | The system's choice |
| `polarPattern`    | `omnidirectional`, `cardioid`, `subcardioid`, `stereo`; applies with `dataSource`                                               | The system's choice |
| `inputGain`       | 0 to 1; applies only where `inputGainSettable` is true                                                                          | Left as it is       |
| `voiceProcessing` | `true` turns on Apple's voice processing on the input                                                                           | Off                 |
| `sampleRate`      | Preferred rate in Hz                                                                                                            | 48000               |
| `seconds`         | Length of the recording                                                                                                         | 10                  |

The result holds `id`, `request`, `started`, `ended`, `frames`, `peak`, `channels`,
`formatSampleRate`, `interleaved` and `voiceProcessing`. `started` and `ended` hold
`category`, `mode`, `sampleRate`, `inputLatency`, `outputLatency`,
`ioBufferDuration`, `inputChannels`, `inputGain`, `inputGainSettable`, `route`,
`outputs` and `inputs`. A port in `inputs` lists its `sources`, each with `name`,
`location`, `orientation`, `polarPatterns` and `selectedPattern`.

Without `capture.json`, an ordinary recording stays on the measurement mode and on
the gain the product sets.
