# @musetric/spectrogram

The frequency spectrogram and the pitch line on WebGPU. The engine draws them
in its spectrogram worker, and the voice range step of `@musetric/ai` runs the
same pitch tracker through `trackPitch`.

## Pitch tracker

`src/fundamentalFrequency` computes the pitch line as a chain of compute
pipelines (`pipeline.ts`).

- Every pipeline has an explicit bind group layout, built from the `kinds` of
  its spec by `computeBufferEntries`: a binding added to a shader is added to
  its `kinds` too. WebGPU does not throw on the mismatch; the pipeline is
  invalid, its dispatches do nothing, and the line stays empty.
- WGSL reserves common words, `smooth` among them, which is why the smoothing
  entry point is `smoothPitch`. `__test__/shaders.test.ts` compiles the pitch
  shaders and fails on a compiler error.

## Measuring the pitch line

`yarn workspace @musetric/spectrogram measure:pitch <stage> --audio <file|dir>`
(`scripts/measurePitch.ts`) scores the tracker against a neural reference. It
is run by hand, never in CI. `ffmpeg` on `PATH` decodes the audio, and the
work runs in headless Chromium under Vitest (`vitest.pitch.config.ts`), which
the package skips on Linux.

| Stage       | What it does                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `reference` | Runs `musetric-pitch` from [musetric/lab](https://github.com/musetric/lab) and writes `reference.csv`                              |
| `extract`   | Runs the tracker and writes `<tag>.csv`                                                                                            |
| `compare`   | Scores `<tag>.csv` against `reference.csv` into `<tag>.compare.md` and `.json`, or into `<tag>.corpus.md` and `.json` for a folder |
| `perf`      | Times the pitch kernels per batch, a full render, a playback frame and the wait of a foreign GPU job into `<tag>.perf.json`        |
| `all`       | `reference`, `extract` and `compare` in order, on each track of a folder                                                           |

`compare` reports:

- accuracy against the reference (`src/__test__/pitchAccuracy.es.ts`): raw
  pitch and raw chroma accuracy within 50 cents (`rpa`, `rca`), voicing recall,
  false alarms, the bias and spread of the error in cents, octave errors, a
  jump of more than 550 cents across a gap (`gap flip`), and a voicing change
  inside a held note of the reference (`note break`);
- the line as a singer sees it (`src/__test__/pitchLine.es.ts`): the share of
  singing time that is clean, missing, wrong, jerky or rattling, events per
  minute of singing (steps, leaps, holes, specks, islands, tails) and the
  delay of note onsets;
- the worst 5 s windows (`--worst`).

Outputs go to `packages/spectrogram/tmp/pitch` (`--out`).
