# @musetric/dsp

Musetric's audio code in Rust: decoding, resampling, the FLAC, WAV, M4A and MP3 writers, loudness, wave peaks, stretch and the microphone's ring. The host links the crate `musetric-dsp` natively, and the same crate builds to WebAssembly as this npm package, so a page computes what the host computes.

| Module                  | Features                      | What it holds                                                                                                                           |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@musetric/dsp/decode`  | `web-decode`                  | `Decoder`, `FlacFeed` and `FlacPages` for FLAC and WAV, `Resampler` and `WavePeaks`                                                     |
| `@musetric/dsp/songs`   | `opus`, `songs`, `web-decode` | the bindings of `decode` for every format the host decodes, Opus included                                                               |
| `@musetric/dsp/stretch` | `web-stretch`                 | the streaming stretch and the mixer of the player's worklet: `openStretcher`, `openMixer` and the functions that take their handles     |
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

The streaming stretch and pitch shift of Signalsmith Stretch, ported to Rust, on a handle that lives as long as the module. Its buffers are in `memory`, one channel after another.

- `openStretcher(channels, sampleRate)` returns a handle.
- `stretcherInputLatency(handle)` and `stretcherOutputLatency(handle)` are the latencies in frames, and `stretcherSeekLength(handle)` the frames of input a seek reads.
- `setStretcherBuffers(handle, length)` makes `2 * channels` buffers of `length` floats, the input channels and then the output channels, and returns their pointer. `length` holds the largest input or output of a call and the seek length.
- `seekStretcher(handle, inputFrames, rate)` primes the stream from `inputFrames` of the input buffers, for playback at `rate`.
- `processStretcher(handle, inputFrames, outputFrames)` consumes `inputFrames` of the input buffers and writes `outputFrames` to the output buffers; their ratio is the tempo.
- `setStretcherSemitones(handle, semitones)` shifts the pitch by whole semitones, `setStretcherFormants(handle, keep)` keeps the formants or not, and `resetStretcher(handle)` empties the stream.

The module also holds the mixer of the player's stems, on a handle that lives as long as the module: pages of the stems' masters in slots of its memory, mixed into the stretcher's input with the gains and the fades of a loop, by the same sum as the host's export.

- `openMixer(channels, stemCount)` returns a handle, and `setMixerStem(handle, stem, frameCount, pageStarts)` lays a stem out in pages, the frames where each begins.
- `mixerPageInput(handle, stem, index, sampleCount)` returns the pointer where the samples of a page go, one channel after another, or 0 when the page does not fit its layout; `dropMixerPage(handle, stem, index)` frees its slot.
- `setMixerVolumes(handle, volumes)` sets the gain of each stem, and `setMixerRange(handle, cycle, frames)` the range `[from, to, end]` of a loop or a stop, empty for none.
- `mixStems(handle, first, count, mask)` mixes the stems of `mask`, a bit per stem, over `count` frames from `first` and returns the pointer of the mix, one channel after another; a page that is not there mixes as silence, and `mixerReady(handle, frame)` says whether every page around a frame is there.

### `capture`

A ring of the last 131 072 samples of one channel, read at any position between them through a windowed sinc kernel, on a handle that lives as long as the module.

- `openCapture()` returns a handle.
- `captureInput(handle, length)` returns the pointer where `length` samples go before `writeCapture(handle, frame, length)` stores them from the frame `frame` of the recording; the frames it skips are silence.
- `setCaptureStep(handle, step)` sets the step of the reads to come: above 1, the kernel's cutoff falls to `1 / step`, against aliasing.
- `renderCapture(handle, at, ratio, length)` reads `length` samples from the position `at`, `ratio` frames apart, into the buffer at `captureOutput(handle)`, and returns the position after the last.
- `clearCapture(handle)` empties the ring.

`@musetric/dsp/stretch.wasm` and `@musetric/dsp/capture.wasm` are their WebAssembly files, which a page compiles for an AudioWorklet, since a worklet can fetch nothing; the worklet passes the module to `initSync`.

The package carries `license.md` and the project's `thirdPartyNotices.md`, with the notices of libopus and of the ports of Signalsmith Stretch and Signalsmith Linear that it builds in.

## Development

```sh
pnpm build:project
```

`build:project` builds the crate for `wasm32-unknown-unknown` once per module, each with only the features its pages call, and writes every module to `dist/` with wasm-bindgen for the web target; `build:app` builds only the modules the app imports. It needs `wasm-bindgen-cli` at the version of `wasm-bindgen` in `packages/server/Cargo.lock`:

```sh
cargo install wasm-bindgen-cli --version <version> --locked
```

- The crate is a member of the Cargo workspace of `packages/server`: its toolchain, lockfile, lints and clippy settings are the host's, and `pnpm check:rust` of `packages/server` checks it natively and as WebAssembly with every feature.
- The default features turn everything on: every format Symphonia reads (`songs`) and Opus (`opus`), which the host decodes, and every binding, which the checks cover. The writers and loudness have no bindings, since the host writes every file.
- Every test runs on both targets; `tests/bytes.rs` holds the digests that both builds must write.
- The stretch and capture modules import nothing from JavaScript, so that they load in an AudioWorklet, which has no `TextDecoder`: their bindings are functions of a handle, not a class, whose borrow checks would throw messages.
- Opus is decoded through libopus, which `opusic-sys` builds with CMake from the sources it bundles. For WebAssembly, `packages/server/.cargo/config.toml` points CMake at `opus-wasm/toolchain.cmake`, which compiles it with `clang` for `wasm32-unknown-unknown` against the headers of `opus-wasm/include`: the few functions of the C library that libopus calls, with `malloc` and `free` on the allocator of Rust through wasm-bindgen. The module `songs` and the checks for WebAssembly need a `clang` that has the WebAssembly target, which the `clang` of Xcode lacks, with `llvm-ar` beside it, and on Windows Ninja, since the generator of Visual Studio that CMake falls back to cannot drive that `clang`.
