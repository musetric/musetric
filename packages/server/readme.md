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

## Decisions it follows

The owner's decisions this package carries out, kept in
[headquarters](https://github.com/musetric/headquarters/tree/main/decisions):

- The host owns the processing: units, checkpoints, HTTP for data and a WebSocket for commands ([R-10](https://github.com/musetric/headquarters/blob/main/decisions/r10-host-owns-processing.md)).
- Audio is decoded and encoded by `crates/media`, without ffmpeg ([R-14](https://github.com/musetric/headquarters/blob/main/decisions/r14-media-without-ffmpeg.md)); a silent stem goes to the absolute gate of BS.1770 instead of failing (R-17, the test `puts_silence_on_the_absolute_gate_instead_of_failing` of `crates/media/src/loudness.rs`).
- A format the decoder cannot read is refused with a clear message ([R-18](https://github.com/musetric/headquarters/blob/main/decisions/r18-unreadable-format-refused.md)).
- One database migration, `V001_INITIAL`, edited in place until the app has users ([R-33](https://github.com/musetric/headquarters/blob/main/decisions/r33-one-migration-until-users.md)).
- The export carries the mix, key and tempo the user hears, stretched by `crates/stretch` ([R-38](https://github.com/musetric/headquarters/blob/main/decisions/r38-export-what-you-hear.md)).
