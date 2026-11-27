# @musetric/engine

The audio engine of the interface: it plays a song from the pages of its stems
and takes, records takes and sends them to the host, calibrates the latency,
and draws the spectrogram and the waves. The frontend creates one engine with
`createEngine`, commands it and reads its state; the engine imports nothing
from the frontend. What the player must do for the user is in headquarters'
[player.md](https://github.com/musetric/headquarters/blob/main/player.md).

## Parts

| Folder         | What it holds                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player`       | Play, Stop, seeks, holds, the range, the loop and its tries, takes, tempo, key and volumes: the session machine on the main thread, and the worklet that renders and plays the song |
| `decoder`      | The worker of the open project: the pages of the stems and takes it reads from the host, the stream of a take to the host, the host's realtime socket, the recordings, the tries    |
| `audioSession` | The microphone of each platform: `getUserMedia` in the browser, the native capture of the apps                                                                                      |
| `audioOutput`  | The output device, and the output clock that reads how far the sound sent runs ahead of the sound heard                                                                             |
| `calibration`  | The latency calibration by clicks, and the latency kept for each pair of devices                                                                                                    |
| `spectrogram`  | The worker that draws the spectrogram of the song and the takes on WebGPU with `@musetric/spectrogram`                                                                              |
| `waveform`     | The worker that draws the waves of the stems and the recording                                                                                                                      |
| `audioRequest` | The workers' requests to the host's HTTP API                                                                                                                                        |
| `measure`      | The tap of the measure build, behind `frontendMeasure`                                                                                                                              |

`engine.ts` builds the parts and connects their ports, `state.ts` holds the
state and the readings derived from it, and `view.ts` the commands of the
picture. The `protocol.cross.ts` of a folder types the messages between the
main thread and its worker or worklet.

## What the frontend uses

- **Commands** are methods of `engine.player`, `engine.view`,
  `engine.calibration`, `engine.microphoneAccess` and `engine.decoder`, which
  mounts a project and undoes and redoes its recording; `engine.spectrogram`
  and `engine.waveform` mount their canvases.
- **Readings**: the position from `engine.position`, a seek from
  `engine.seeks`, the transport through `isPlaying`, `isRecording`,
  `isTransportBusy` and `isBuffering`, and the rest of the state from
  `engine.store`, which only the engine writes.

## Position and transport

- The worklet's timeline map (`player/heardPosition.worklet.ts`) is the only
  writer of the position. It publishes the playhead on every change of its
  line and in a pulse of 15 Hz to the main thread and the spectrogram worker
  (`player/playhead.worklet.ts`), and each of them shows it through one
  presenter (`player/playheadPresenter.cross.ts`)
  ([#1369](https://github.com/musetric/musetric/issues/1369)).
- The transport has one writer on each thread: the session machine
  (`player/session.ts`) holds what the user asked for, and the worklet's
  motion (`player/motion.worklet.ts`) what really sounds
  ([#1371](https://github.com/musetric/musetric/issues/1371)).

## Tests

The tests run the worklet's runtime, the decoder and the capture in Node on
the WebAssembly of `@musetric/dsp`, which `pnpm --filter @musetric/dsp
build:project` builds first. `player/__test__/seam.test.ts` is the oracle of
the seam between the main thread, the decoder and the worklet
([#1368](https://github.com/musetric/musetric/issues/1368)).
