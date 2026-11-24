# @musetric/measure

Measures recording on a real device. Each command drives a page of a measure
build over the Chrome DevTools protocol, records into a temporary recording of
the open project, deletes it afterwards and writes the runs and `report.md` to
`packages/measure/tmp/measure/<command>`. It is run by hand, never in CI.

## Commands

| Command                                           | What it measures                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @musetric/measure measure:timing`  | The playhead against the click the microphone hears, the take against the beats ([#1072](https://github.com/musetric/musetric/issues/1072))                                 |
| `pnpm --filter @musetric/measure measure:delay`   | How far the voice line, the spectrogram and the newest audio trail the playhead ([#1072](https://github.com/musetric/musetric/issues/1072))                                 |
| `pnpm --filter @musetric/measure measure:sound`   | A synthetic file through the browser path and through a take, gaps in a long take ([#1072](https://github.com/musetric/musetric/issues/1072))                               |
| `pnpm --filter @musetric/measure measure:cursor`  | The shown cursor through Play, Stop, seeks, a drag and a loop: steps back, stalls and jumps ([#1368](https://github.com/musetric/musetric/issues/1368))                     |
| `pnpm --filter @musetric/measure measure:failure` | A fault thrown in the player during a take: the notice, the stop, the take on the host, and play after a reload ([#1365](https://github.com/musetric/musetric/issues/1365)) |
| `pnpm --filter @musetric/measure measure:seek`    | Seeks to far frames while playing: the time to the first sound and the range requests of the stems ([#1364](https://github.com/musetric/musetric/issues/1364))              |

Every command first runs the app's calibration check and stops if it fails; a
call it cannot parse prints its options. Open a project before running one.
A take is kept as it was recorded, never stretched: frame k of a piece sung at
tempo t lies on the song at the piece's start plus k × t, so at every tempo the
take's distance from the beats is in milliseconds as heard, like the playhead's.
`measure:delay` and `measure:sound` play their file from this computer with
`ffplay`, which must be on `PATH`: put the speaker next to the microphone.

## Measure build

A frontend built with `frontendMeasure=true` carries the engine's measure
points; what uses them lives in `src/__test__` and runs in the page, in its
spectrogram worker and in its audio worklet.

- Android: `frontendMeasure=true pnpm build:android`. Like every development
  build, the APK is Musetric Dev, whose WebView can be inspected; the command
  forwards its socket with `adb`.
- Chrome: the frontend run with `frontendMeasure=true` and Chrome with
  `--remote-debugging-port=9334`, then `--device chrome`.
- Desktop app: `frontendMeasure=true pnpm build:app`, started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set to the app's own WebView2
  arguments from `src-tauri/src/lib.rs` plus `--remote-debugging-port=9335`,
  then `--device desktop`.
