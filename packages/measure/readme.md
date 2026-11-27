# @musetric/measure

Measures recording on a real device. Each command drives a page of a measure
build over the Chrome DevTools protocol, records into a temporary recording of
the open project, deletes it afterwards and writes the runs and `report.md` to
`packages/measure/tmp/measure/<command>`. It is run by hand, never in CI, and
needs nothing built beforehand: each command first builds the WebAssembly of
`@musetric/dsp` that it puts into the page.

## Commands

| Command                                           | Output | What it measures                                                                                                                                                            |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @musetric/measure measure:timing`  | aloud  | The playhead against the click the microphone hears, the take against the beats ([#1072](https://github.com/musetric/musetric/issues/1072))                                 |
| `pnpm --filter @musetric/measure measure:delay`   | aloud  | How far the voice line, the spectrogram and the newest audio trail the playhead ([#1072](https://github.com/musetric/musetric/issues/1072))                                 |
| `pnpm --filter @musetric/measure measure:sound`   | aloud  | A synthetic file through the browser path and through a take, gaps in a long take ([#1072](https://github.com/musetric/musetric/issues/1072))                               |
| `pnpm --filter @musetric/measure measure:cursor`  | silent | The shown cursor through Play, Stop, seeks, a drag and a loop: steps back, stalls and jumps ([#1368](https://github.com/musetric/musetric/issues/1368))                     |
| `pnpm --filter @musetric/measure measure:failure` | silent | A fault thrown in the player during a take: the notice, the stop, the take on the host, and play after a reload ([#1365](https://github.com/musetric/musetric/issues/1365)) |
| `pnpm --filter @musetric/measure measure:seek`    | silent | Seeks to far frames while playing: the time to the first sound and the range requests of the stems ([#1364](https://github.com/musetric/musetric/issues/1364))              |
| `pnpm --filter @musetric/measure measure:frame`   | silent | The spectrogram's frames while playing and in a swipe of the progress bar, its screens against the ruler ([#1426](https://github.com/musetric/musetric/issues/1426))        |

A command that plays aloud measures with the calibration stored for the setup
and stops before it plays when there is none; `--calibrate` runs the app's
calibration first, which plays its clicks aloud. A silent command needs no
calibration and refuses `--calibrate`: before every Play and take it mutes the
output of the measure build, checks in the page that it is silent and stops if
it is not, and the page stays muted until a command that plays aloud or a
reload. A call it cannot parse prints its options. Open a project before
running one.
A take is kept as it was recorded, never stretched: frame k of a piece sung at
tempo t lies on the song at the piece's start plus k × t, so at every tempo the
take's distance from the beats is in milliseconds as heard, like the playhead's.
`measure:delay` and `measure:sound` play their file from this computer with
`ffplay`, which must be on `PATH`: put the speaker next to the microphone.
`measure:frame` swipes the progress bar with `adb shell input swipe`, captures
the screen during the swipe and then the stopped picture at each capture's
place, and compares the shift of the picture with the shift of the ruler; the
parts of a frame, each GPU pass and the work before the submit, come only from
a build with `frontendSpectrogramProfiling=true` as well.

## Measure build

A frontend built with `frontendMeasure=true` carries the engine's measure
points, among them the gain its output passes through, which the commands mute
and unmute; what uses them lives in `src/__test__` and runs in the page, in its
spectrogram worker and in its audio worklet. The variable goes before the
[app's commands](../app/readme.md#commands).

- Android: `frontendMeasure=true pnpm build:android`, then
  `pnpm start:android <serial> --install`. The APK is Musetric Dev, whose
  WebView can be inspected; the command forwards its socket with `adb`.
- Chrome: the frontend run with `frontendMeasure=true` and Chrome with
  `--remote-debugging-port=9334`, then `--device chrome`.
- Desktop app: `frontendMeasure=true pnpm build:app`, started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9335`, then
  `--device desktop`. `measure:delay` does not run there: WebView2 answers
  `Target.setAutoAttach`, through which the command reaches the spectrogram's
  worker, with `wasn't found`. The take comes from the app's native capture.
