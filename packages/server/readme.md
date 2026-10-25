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
