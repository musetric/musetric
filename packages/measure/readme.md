# @musetric/measure

Measures recording on a real device. Each command drives a page of a measure
build over the Chrome DevTools protocol, records into a temporary recording of
the open project, deletes it afterwards and writes the runs and `report.md` to
`packages/measure/tmp/measure/<command>`. It is run by hand, never in CI.

## Commands

| Command                                           | What it measures                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn workspace @musetric/measure measure:timing` | The playhead against the click the microphone hears, the take against the beats ([#1059](https://github.com/musetric/musetric/issues/1059))   |
| `yarn workspace @musetric/measure measure:delay`  | How far the voice line, the spectrogram and the newest audio trail the playhead ([#1071](https://github.com/musetric/musetric/issues/1071))   |
| `yarn workspace @musetric/measure measure:sound`  | A synthetic file through the browser path and through a take, gaps in a long take ([#1070](https://github.com/musetric/musetric/issues/1070)) |

Every command first runs the app's calibration check and stops if it fails; a
call it cannot parse prints its options. Open a project before running one.
`measure:delay` and `measure:sound` play their file from this computer with
`ffplay`, which must be on `PATH`: put the speaker next to the microphone.

## Measure build

A frontend built with `frontendMeasure=true` carries the engine's measure
points; what uses them lives in `src/__test__` and runs in the page and in its
spectrogram worker.

- Android: `frontendMeasure=true yarn build:android` also turns on WebView
  debugging in the release APK; the command forwards its socket with `adb`.
- Chrome: the frontend run with `frontendMeasure=true` and Chrome with
  `--remote-debugging-port=9334`, then `--device chrome`.
- Desktop app: `frontendMeasure=true yarn build:app`, started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set to the app's own WebView2
  arguments from `src-tauri/src/lib.rs` plus `--remote-debugging-port=9335`,
  then `--device desktop`.
