# @musetric/server

The Rust host: HTTP API, storage, processing queue and GPU executor, a
self-contained Cargo workspace with its own toolchain pin and lockfile.

## Rules

- A change to a step's unit plan (stride, overlap, windows per unit) bumps
  that step's `DSP_VERSION`.
- `src/analysis/models.rs` pins every model at the head of `main` of its
  Hugging Face repository ([pins](https://github.com/musetric/headquarters/blob/main/practices/models.md#pins));
  `yarn workspace @musetric/server check:models` checks it.
- A model file counts as cached only next to its manifest `<file>.verified`
  (`crates/gpu/src/cache.rs`); the host deletes a file without one and
  downloads it again.
- An unpublished revision is tried in a local build only: the pin points at it
  with every changed file's sha256 and size, and the files and their manifests
  go to the paths of `ModelBundle::cached` under the app's
  [`models` folder](../app/readme.md#data) before the step starts.
- A recording is `RecordingPiece` rows in two layers, `base` and `fresh`
  (`crates/db/src/schema.rs`); undo, redo and the next take are in
  `src/recording/store.rs` and `src/recording/plan.rs`.
- The host (`write_chunk` in `src/realtime/session.rs`) and the engine
  (`continuesRun` in `packages/engine/src/player/liveTake.cross.ts`) split a
  take into runs by the same rule: a change to one is a change to both.

## A second server

A server next to the one of `yarn dev`, which keeps its data in `storage/`,
takes its own `--database`, `--blobs` and `--work`; `--processing false` starts
no browser and runs no step. From `packages/server`:

```sh
cargo run --locked -- --listen 127.0.0.1:<port> --database <dir>/db/app.db --blobs <dir>/blobs --work <dir>/work --models storage/models --browser-bundle dist-browser --public <frontend build> --processing false
```

## Decisions it follows

- The host owns the processing: units, checkpoints, HTTP for data and a WebSocket for commands ([R-10](https://github.com/musetric/headquarters/blob/main/decisions/r10-host-owns-processing.md)).
- Audio is decoded and encoded by `crates/media`, without ffmpeg ([R-14](https://github.com/musetric/headquarters/blob/main/decisions/r14-media-without-ffmpeg.md)).
- A silent stem goes to the absolute gate of BS.1770 instead of failing, as the test `puts_silence_on_the_absolute_gate_instead_of_failing` of `crates/media/src/loudness.rs` checks ([R-17](https://github.com/musetric/headquarters/blob/main/decisions/readme.md#decisions-that-became-rules)).
- A format the decoder cannot read is refused with a clear message ([R-18](https://github.com/musetric/headquarters/blob/main/decisions/r18-unreadable-format-refused.md)).
- One database migration, `V001_INITIAL`, edited in place until the app has users ([R-33](https://github.com/musetric/headquarters/blob/main/decisions/r33-one-migration-until-users.md)).
- The export carries the mix, key and tempo the user hears, stretched by `crates/stretch` ([R-38](https://github.com/musetric/headquarters/blob/main/decisions/r38-export-what-you-hear.md)).
