# @musetric/server

The Rust host: HTTP API, storage, processing queue and GPU executor, a
self-contained Cargo workspace with its own toolchain pin and lockfile.

## Processing steps

- A change to a step's unit plan (stride, overlap, windows per unit) bumps
  that step's `DSP_VERSION`. An interrupted step resumes its checkpoint when
  the computation id matches, and the unit plan is not part of that id, so
  without the bump the old checkpoint continues with the new layout.

## Model pins

- `src/analysis/models.rs` pins every model at the head of `main` of its
  repository on Hugging Face. `yarn workspace @musetric/server check:models`
  checks that, and CI runs it on every pull request.
- A model file counts as cached only next to its manifest `<file>.verified`,
  one line `size=<bytes> modified=<mtime in ns since the epoch> sha256=<hex>`
  without a newline (`crates/gpu/src/cache.rs`). Without the manifest, the
  host deletes the file and downloads it again, even when its hash matches the
  pin; a manifest whose size or time no longer match makes the host hash the
  file again and rewrite the manifest when the hash matches.
- A revision not yet published to Hugging Face is checked on a device without
  publishing it. Point the pin at it, with the sha256 and size of every
  changed file, in a local build only: `check:models` rejects such a pin. Then
  put the files with their manifests at the paths `ModelBundle::cached` gives
  under the app's `models` folder before the step starts, since the host
  cannot download a revision Hugging Face does not have. On Android the folder
  is reached with `adb shell run-as com.musetric.client`, which only a debug
  APK allows; the folders are in the app's [readme](../app/readme.md#data).

## Takes

- A recording is a set of `RecordingPiece` rows, each a mono 16-bit WAV blob
  placed on the song by `songStartFrame` and `tempo`, in one of two layers
  (`crates/db/src/schema.rs`). `base` holds the takes already merged, pieces
  that do not overlap, with touching neighbours of the same tempo, key and
  octave joined into one; `fresh` holds the last take.
- `Recording.freshApplied` says whether the fresh layer sounds over the base.
  Undo and redo flip it and touch no file, so a recording keeps one step of
  history (`set_fresh_applied` in `src/recording/store.rs`). The next take
  first merges an applied fresh layer into the base, or drops an undone one,
  and then becomes the fresh layer itself (`commit_take` in the same file,
  `merge_fresh` in `src/recording/plan.rs`).
- A take is every run between the seeks of one recording. A packet whose
  `offset` is 0, or whose `startFrame` differs from the run before, opens a
  new run (`write_chunk` in `src/realtime/session.rs`), and a later run lies
  over the earlier ones where they overlap (`plan_take` in `plan.rs`). The
  player and the spectrogram split the live take by the same rule,
  `continuesRun` of `packages/engine/src/player/liveTake.cross.ts`: a change
  to one is a change to both.

## A second server

A server started next to the one of `yarn dev`, which keeps its data in
`storage/`, takes its own `--database`, `--blobs` and `--work`. The storage
lock refuses a second server on the same database (`src/serve.rs`), and every
five minutes `src/garbage.rs` deletes the blobs older than five minutes that
its own database does not reference, so a server pointed at another one's
`--blobs` deletes that one's audio. `--processing false` starts no browser and
runs no step. From `packages/server`:

```sh
cargo run --locked -- --listen 127.0.0.1:<port> --database <dir>/db/app.db --blobs <dir>/blobs --work <dir>/work --models storage/models --browser-bundle dist-browser --public <frontend build> --processing false
```

## Decisions it follows

The owner's decisions this package carries out, kept in
[headquarters](https://github.com/musetric/headquarters/tree/main/decisions):

- The host owns the processing: units, checkpoints, HTTP for data and a WebSocket for commands ([R-10](https://github.com/musetric/headquarters/blob/main/decisions/r10-host-owns-processing.md)).
- Audio is decoded and encoded by `crates/media`, without ffmpeg ([R-14](https://github.com/musetric/headquarters/blob/main/decisions/r14-media-without-ffmpeg.md)); a silent stem goes to the absolute gate of BS.1770 instead of failing (R-17, the test `puts_silence_on_the_absolute_gate_instead_of_failing` of `crates/media/src/loudness.rs`).
- A format the decoder cannot read is refused with a clear message ([R-18](https://github.com/musetric/headquarters/blob/main/decisions/r18-unreadable-format-refused.md)).
- One database migration, `V001_INITIAL`, edited in place until the app has users ([R-33](https://github.com/musetric/headquarters/blob/main/decisions/r33-one-migration-until-users.md)).
- The export carries the mix, key and tempo the user hears, stretched by `crates/stretch` ([R-38](https://github.com/musetric/headquarters/blob/main/decisions/r38-export-what-you-hear.md)).
