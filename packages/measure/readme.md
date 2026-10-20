# @musetric/measure

Measures recording on a real device: timing (#1059), delay (#1071) and sound (#1070).
Each command drives a page of a measure build over the Chrome DevTools protocol,
records into a temporary recording of the open project, deletes it afterwards
and writes the runs and `report.md` to `packages/measure/tmp/measure/<command>`
(`--out`). It is run by hand, never in CI.

## Commands

| Command                                           | What it measures                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn workspace @musetric/measure measure:timing` | Takes with the metronome: the playhead against the click the microphone hears, the take against the beats                                                                        |
| `yarn workspace @musetric/measure measure:delay`  | Takes of a held vowel in the notes and spectrum views: how far the voice line, the spectrogram and the newest audio trail the playhead, microphone chunk arrival, the round trip |
| `yarn workspace @musetric/measure measure:sound`  | A synthetic file through the browser path and through a take: third-octave bands, bursts against the vowel, peak, noise in the pauses; gaps in a long take with the song         |

Every command calibrates the setup with the app's check first and stops if
the check fails, so timing and delay are only measured calibrated.
`--keep-calibration` measures with the stored calibration instead.
`--reanalyze` reads the runs already in `--out` again without a device.
An unknown command or option prints the usage.

## Measure build

The measure points live in the engine and are compiled in only when the
frontend is built with `frontendMeasure=true`: the page then gets the
`musetricMeasure` entry the commands call, and the spectrogram worker logs the
drawn edges after each third frame.

- Android: `frontendMeasure=true yarn build:android` also turns on WebView
  debugging in the release APK. The command forwards the WebView's DevTools
  socket with `adb` (`--serial` when several phones are attached).
- Chrome: run the frontend with `frontendMeasure=true` and Chrome with
  `--remote-debugging-port=9334`, then `--device chrome`.
- Desktop app: build with `frontendMeasure=true yarn build:app` and start it
  with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set to the app's own WebView2
  arguments from `src-tauri/src/lib.rs` plus `--remote-debugging-port=9335`,
  then `--device desktop`.

Open a project before running a command. `measure:delay` and `measure:sound`
play their file from this computer with `ffplay`, which must be on `PATH`:
put the speaker next to the device's microphone.

On Android the file comparison of `measure:sound` needs Bluetooth off: with a
headset connected the WebView records the headset microphone and keeps the
call route until the app restarts, so the command refuses it on a Bluetooth
output. `--take-only` records just the long take with the song, which is the
part to run on Bluetooth.
