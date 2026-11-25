# @musetric/dsp

Musetric's audio code in Rust: decoding, resampling, the FLAC, WAV, M4A and MP3 writers, loudness, wave peaks, stretch, the renderer of a song and the microphone's ring. The host links the crate `musetric-dsp` natively, and the same crate builds to WebAssembly as this npm package, so a page computes what the host computes.

| Module                  | Features                      | What it holds                                                                                                                           |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@musetric/dsp/decode`  | `web-decode`                  | `Decoder`, `FlacFeed` and `FlacPages` for FLAC and WAV, `Resampler` and `WavePeaks`                                                     |
| `@musetric/dsp/songs`   | `opus`, `songs`, `web-decode` | the bindings of `decode` for every format the host decodes, Opus included                                                               |
| `@musetric/dsp/stretch` | `web-stretch`                 | the renderer of the player's worklet: `openRenderer` and the functions that take its handle                                             |
| `@musetric/dsp/capture` | `web-capture`                 | the ring of the microphone's worklets, read at any position through a sinc kernel: `openCapture` and the functions that take its handle |

## API

```sh
npm install @musetric/dsp
```

```ts
import init, { Decoder } from '@musetric/dsp/songs';

await init();
const decoder = new Decoder(bytes, 'mp3', 48_000, false);
for (let chunk = decoder.read(); chunk; chunk = decoder.read()) {
  consume(chunk);
}
decoder.free();
```

Each module is an ES module for the web. Its default export `init` fetches its WebAssembly from beside it, through `new URL(..., import.meta.url)`, which bundlers such as Vite follow, and returns the module's exports, `memory` among them; `initSync({ module })` takes a compiled `WebAssembly.Module` or its bytes instead. Samples are 32-bit floats, interleaved by frame, and a failure throws an `Error` with the message of Rust. A class holds memory of the module until `free()`, or the end of its `using` block. A pointer is a byte offset into `memory` and stays valid until the next call into the module, which may grow the memory and replace `memory.buffer`.

### `songs` and `decode`

- `new Decoder(bytes, extension, sampleRate, keepChannels)` opens a whole file. `extension`, such as `'mp3'`, is a hint to the probe of the format, and `null` leaves the probe to the content. `sampleRate` is the rate of the output, through the resampler below, and `null` keeps the file's own. `keepChannels` keeps the channels of the file; `false` folds them to stereo, a mono file to both sides at -3 dB. `channels` and `sampleRate` are those of the output, and `frameCount` is the count of frames that the container declares, at the output rate, or `undefined` when it declares none, as a fragmented MP4 does; the frames decoded may differ from it at the edges, by the priming of AAC or the pre-skip of Opus. `read()` returns the next samples, an empty array while the resampler fills, and `undefined` after the end of the file.
- `new FlacFeed(sampleRate)` decodes FLAC that arrives in parts, with the channels of the stream, at `sampleRate` or the stream's own rate. `push(bytes)` takes the next bytes and returns how many samples it has decoded, which wait at `readyPointer`; a part is decoded once the seek table says that all of it has arrived, so a stream without a seek table is decoded by `finish()`, which decodes what is left and returns the same. `channels` and `frameCount`, at the output rate, are known once the header has arrived, and `frameCount` only when the header counts the frames.
- `FlacPages.read(prefix)` reads the header of a FLAC master from its first bytes, or returns `undefined` while they do not hold all of it, and cuts the master into pages at the points of its seek table, so that a page is fetched by a range request and decoded alone. `channels`, `sampleRate`, `frameCount` and `pageCount` describe the master; `pageStart(index)` and `pageFrames(index)` give the frames of a page, and `byteStart(index)` and `byteEnd(index)` its bytes, with `byteEnd` `undefined` for the last page, which runs to the end of the file. `decode(index, bytes)` decodes the bytes of a page at the master's own rate, one channel after another. `decodeMean(index, bytes)` decodes a stereo page to the mean of its two channels, the downmix the host analyses the voice with.
- `new Resampler(input, output, channels)` converts between two rates with the FFT resampler of rubato, and passes the samples through when they are equal. `convert(samples)` returns the output ready so far, without the resampler's delay. `flush(inputFrames)`, given the count of every input frame, returns the rest, so that the whole output holds `round(inputFrames * output / input)` frames.
- `new WavePeaks(frameCount)` traces the waveform of a song of `frameCount` frames, as the host traces it: 3840 pairs of the minimum and the maximum of the mean of the two channels, each over an equal span of the frames. `push(samples)` takes the next stereo samples, and the frames past `frameCount` are left out; `peaks()` returns the 7680 floats traced so far, with zeros for the spans that no sample has reached.

### `stretch`

The renderer of a song, on a handle that lives as long as the module: the pages of the stems' masters, the pieces of a recording and the streaming stretch and pitch shift of Signalsmith Stretch, ported to Rust, rendered one quantum at a time. The host runs the same renderer natively in `render::render_song`, quantum by quantum from the first frame, so an export holds the samples the player plays.

- `openRenderer(sampleRate)` returns a handle.
- `setRendererTrack(handle, track, frameCount, pageStarts)` lays a track out in pages, the frames where each begins, and keeps its pages while the layout stays; the tracks 0, 1 and 2 are the lead, the backing and the instrumental, and the takes follow them. `rendererPageInput(handle, track, index, sampleCount)` returns the pointer where the samples of a page go, one channel after another, or 0 when the page does not fit its layout; `dropRendererPage(handle, track, index)` frees its slot, `reserveRendererPages(handle, count)` makes the slots ahead, and `rendererReady(handle, frame)` says whether every page of the stems and the takes around a frame is there. A page that is not there renders as silence.
- `setRendererVolumes(handle, volumes)` sets the gain of each stem, and `setRendererRange(handle, cycle, frames)` the range `[from, to, end]` of a loop or a stop, empty for none.
- `setRendererTempo(handle, tempo)` and `setRendererTranspose(handle, semitones)` set the song's tempo and key, `setRendererVoice(handle, octave, shifted)` the octave the voice moves by, which renders the lead apart with its formants kept and moves the takes, and `setRendererRecordingVolume(handle, volume)` the gain of the takes.
- `setRendererTakes(handle, pieces)` lays out the pieces of the recording that sound, six numbers each, `[track, songStart, tempo, transpose, octave, frameCount]`: a piece is sung from the song frame `songStart` on its track, a later one over an earlier one. It returns `false` when the numbers do not fit or a piece lies on the track of a stem.
- `renderQuantum(handle, frame, takeFrame, frames)` renders `frames` frames from the song frame `frame`, with the takes at the song frame `takeFrame`, or without them for `NaN`, into the buffer at `rendererOutput(handle)`, one channel after another, and returns the frames of the song it went through. `resetRenderer(handle)` empties the stretch, and `refillRenderer(handle)` primes it again at the next frame.

### `capture`

A ring of the last 131 072 samples of one channel, read at any position between them through a windowed sinc kernel, on a handle that lives as long as the module.

- `openCapture()` returns a handle.
- `captureInput(handle, length)` returns the pointer where `length` samples go before `writeCapture(handle, frame, length)` stores them from the frame `frame` of the recording; the frames it skips are silence.
- `setCaptureStep(handle, step)` sets the step of the reads to come: above 1, the kernel's cutoff falls to `1 / step`, against aliasing.
- `renderCapture(handle, at, ratio, length)` reads `length` samples from the position `at`, `ratio` frames apart, into the buffer at `captureOutput(handle)`, and returns the position after the last.
- `clearCapture(handle)` empties the ring.

`@musetric/dsp/stretch.wasm` and `@musetric/dsp/capture.wasm` are their WebAssembly files, which a page compiles for an AudioWorklet, since a worklet can fetch nothing; the worklet passes the module to `initSync`.

The package carries `license.md`, the project's `thirdPartyNotices.md`, with the notices of `symphonia-opus` and of the ports of Signalsmith Stretch and Signalsmith Linear that it builds in, and `notices/crates.md`, with the licenses of the Rust crates compiled into its WebAssembly modules.

## Development

```sh
pnpm build:project
```

`build:project` builds the crate for `wasm32-unknown-unknown` once per module, each with only the features its pages call, and writes every module to `dist/` with wasm-bindgen for the web target; `build:app` builds only the modules the app imports, and every build of the app runs it first ([the app's commands](../app/readme.md#commands)). It needs `wasm-bindgen-cli` at the version of `wasm-bindgen` in `packages/server/Cargo.lock`:

```sh
cargo install wasm-bindgen-cli --version <version> --locked
```

- The crate is a member of the Cargo workspace of `packages/server`: its toolchain, lockfile, lints and clippy settings are the host's, and `pnpm check:rust` of `packages/server` checks it natively and as WebAssembly with every feature.
- The default features turn everything on: every format Symphonia reads (`songs`) and Opus (`opus`), which the host decodes, and every binding, which the checks cover. The writers and loudness have no bindings, since the host writes every file.
- Every test runs on both targets; `tests/bytes.rs` holds the digests that both builds must write.
- The stretch and capture modules import nothing from JavaScript, so that they load in an AudioWorklet, which has no `TextDecoder`: their bindings are functions of a handle, not a class, whose borrow checks would throw messages.
- Opus is decoded by `symphonia-opus`, in Rust, which `packages/server/Cargo.toml` takes through `[patch.crates-io]` from its fork [musetric/symphonia-opus](https://github.com/musetric/symphonia-opus) at one commit: the decoder computes its cosines, sines, exponentials and powers through `libm`, so that the host and WebAssembly decode the same samples. `decode.rs` trims the pre-skip and the end padding of an Opus stream, which `symphonia-opus` leaves to the reader, so that a song decodes to as many frames as `frame_count` gives.
