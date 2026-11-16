# wasm-dsp

The host's audio code built for WebAssembly and measured against what the interface, the executor and the site run today.

- `core` is a Rust crate that compiles `resample.rs`, `aac.rs` and `depth.rs` of `packages/server/crates/media` as they are, and `musetric-stretch`. Its `decode.rs` and `encode.rs` are those of the media crate, reading from and writing to memory instead of files. It builds natively and for `wasm32-unknown-unknown`, with and without SIMD.
- `web` runs the same module in Chrome against WebCodecs, the stem decoder of `packages/audio`, the resampler of `musetric/landing`, libsamplerate-js, signalsmith-stretch and the encoders of Mediabunny.

It needs Rust at the crate's `rust-version` with the `wasm32-unknown-unknown` target, Node.js, Google Chrome, ffmpeg with libvorbis and libopus, and `musetric/landing` cloned next to this repository.

```sh
node bench.mjs inputs <song>
node bench.mjs all
```

The song is Rxbyn, "Bad Side" (https://www.jamendo.com/track/1556580/bad-side, CC BY 3.0). The inputs, the builds, `node_modules` and the results go to `tmp/wasm-dsp` of the workspace root, or to `WASM_DSP_WORK`.

- Everything runs on one thread, without `SharedArrayBuffer`: the app's pages are not cross-origin isolated.
- The module exports plain functions over its memory; a package would use wasm-bindgen.
