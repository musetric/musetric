# @musetric/dsp

Musetric's audio code in Rust: decoding, resampling, the FLAC, WAV, M4A and MP3 writers, loudness, wave peaks, stretch and the microphone's ring. The host links the crate `musetric-dsp` natively, and the same crate builds to WebAssembly as this npm package, so a page computes what the host computes.

```sh
pnpm build:project
```

`build:project` builds the crate for `wasm32-unknown-unknown` once per module, each with only the features its pages call, and writes every module to `dist/` with wasm-bindgen for the web target. It needs `wasm-bindgen-cli` at the version of `wasm-bindgen` in `packages/server/Cargo.lock`:

```sh
cargo install wasm-bindgen-cli --version <version> --locked
```

| Module                  | Features      | What it holds                                                                                                                           |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@musetric/dsp/decode`  | `web-decode`  | `Decoder` and `FlacFeed` for FLAC and WAV, `Resampler` and `wavePeaks`                                                                  |
| `@musetric/dsp/stretch` | `web-stretch` | the streaming stretch of the player's worklet: `openStretcher` and the functions that take its handle                                   |
| `@musetric/dsp/capture` | `web-capture` | the ring of the microphone's worklets, read at any position through a sinc kernel: `openCapture` and the functions that take its handle |

```ts
import init, { Decoder } from '@musetric/dsp/decode';

await init();
const decoder = new Decoder(bytes, 'wav', 48_000, false);
for (let chunk = decoder.read(); chunk; chunk = decoder.read()) {
  consume(chunk);
}
decoder.free();
```

- The crate is a member of the Cargo workspace of `packages/server`: its toolchain, lockfile, lints and clippy settings are the host's, and `pnpm check:rust` of `packages/server` checks it natively and as WebAssembly with every feature.
- The default features turn everything on: every format Symphonia reads (`songs`), which the host decodes, and every binding, which the checks cover. The writers and loudness have no bindings, since the host writes every file.
- Every test runs on both targets; `tests/bytes.rs` holds the digests that both builds must write.
- The stretch and capture modules import nothing from JavaScript, so that they load in an AudioWorklet, which has no `TextDecoder`: their bindings are functions of a handle, not a class, whose borrow checks would throw messages.
- Opus is decoded only natively, through libopus with the `opus` feature.
