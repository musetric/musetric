# @musetric/server

The Rust host: HTTP API, storage, processing queue and GPU executor, a
self-contained Cargo workspace with its own toolchain pin and lockfile.

## Rules

- A change to the unit plan of transcription (stride, overlap, windows per
  unit, channels in or out) bumps its `DSP_VERSION`. Separation plans its units
  in `@musetric/ai` (`src/separation`): the host serves it the decoded mixture,
  stores the stems and the state each unit sends, and keeps none of its math.
- The host reads the
  [pins](https://github.com/musetric/headquarters/blob/main/practices/models.md#pins) of the models
  from the `pin.json` files of `packages/ai/src/runtime`, embedded at build
  time; `src/analysis/models.rs` adds only what the host keeps for itself: the
  folder and the label of each model in its cache.
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
- It is the host of [the product](https://github.com/musetric/headquarters/blob/main/product.md#how-it-is-built): the units
  and checkpoints of a step are in `src/analysis/stage_attempt.rs`.
- `crates/media` decodes and encodes all audio, and the import of
  `src/routes/project.rs` refuses a format it cannot read with a message that
  says so.
- A silent stem goes to the absolute gate of BS.1770 instead of failing, as
  the test `puts_silence_on_the_absolute_gate_instead_of_failing` of
  `crates/media/src/loudness.rs` checks.
- The database has one migration, `V001_INITIAL` of `crates/db/src/schema.rs`,
  edited in place until the app has users: nobody has data to keep yet, and a
  migration written now would be carried forever. A local database of an
  older schema is deleted, not migrated. This is revisited before the first
  release ([#1099](https://github.com/musetric/musetric/issues/1099)).
- The export is stretched by `crates/stretch`, the host's own Rust port of
  Signalsmith Stretch, which keeps it free of unsafe code and of a C++
  toolchain on every target.
- A column that names a blob ends in `blobId`: the collector keeps exactly the
  files those columns name. `crates/db/src/tests.rs` checks that every such
  column is read by `REFERENCED_BLOB_IDS` of `crates/db/src/blob.rs`, and that
  every other `TEXT` column whose name ends in `Id` is known to hold no blob.

## Storage

The host keeps a project's files in two folders.

- `--blobs` holds the finished files, each under the first two byte pairs of
  its id (`blob_path` of `crates/db/src/blob.rs`). A file enters it only
  through `publish` of `src/publish.rs`, which moves it in and writes the row
  that names it while the collector waits. Every five minutes the collector of
  `src/garbage.rs` removes the files older than five minutes that no row
  names.
- `--work` holds what is not finished (`src/blobs.rs`): `upload/` the files of
  a request being read, `<project id>/<step>/` the area and checkpoints of a
  step, `<project id>/recording/` the take being recorded, `mixdown/` the
  exports of the last hour, and `executor-browser/` the profile of the
  executor's browser. A step removes its area when it finishes and keeps it
  after a failure or a pause, to resume from it.

What no project needs is removed: removing a project removes its folder under
`--work`; at start the host empties `upload/` and `mixdown/`; at start and
every five minutes the collector removes the folder of every project the
database no longer has, which catches a step that wrote after its project was
removed.

## A second server

A server next to the one of `yarn dev`, which keeps its data in `storage/`,
takes its own `--database`, `--blobs` and `--work`; `--processing false` starts
no browser and runs no step. From `packages/server`:

```sh
cargo run --locked -- --listen 127.0.0.1:<port> --database <dir>/db/app.db --blobs <dir>/blobs --work <dir>/work --models storage/models --browser-bundle dist-browser --public <frontend build> --processing false
```
