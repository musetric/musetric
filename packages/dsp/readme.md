# @musetric/dsp

Musetric's audio code in Rust: decoding, resampling, the FLAC, WAV, M4A and MP3 writers, loudness, wave peaks and stretch. The host links the crate `musetric-dsp` natively, and the same crate builds to WebAssembly as this npm package, so a page computes what the host computes.

```sh
pnpm build:wasm
```

`build:wasm` builds the crate for `wasm32-unknown-unknown` and writes `dist/` with wasm-bindgen for the web target. It needs `wasm-bindgen-cli` at the version of `wasm-bindgen` in `packages/server/Cargo.lock`:

```sh
cargo install wasm-bindgen-cli --version <version> --locked
```

```ts
import init, { decode, encodeFlac } from '@musetric/dsp';

await init();
const decoded = decode(bytes, 'mp3', 44_100);
```

- The crate is a member of the Cargo workspace of `packages/server`: its toolchain, lockfile, lints and clippy settings are the host's, and `pnpm check:rust` of `packages/server` checks it natively and as WebAssembly.
- Every test runs on both targets; `tests/bytes.rs` holds the digests that both builds must write.
- Opus is decoded only natively, through libopus with the `opus` feature.
