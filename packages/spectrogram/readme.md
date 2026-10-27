# @musetric/spectrogram

The frequency spectrogram and the pitch line on WebGPU. The engine draws them
in its spectrogram worker, and the voice range step of `@musetric/ai` runs the
same pitch tracker through `trackPitch`.

## Pitch tracker

`src/fundamentalFrequency` computes the pitch line as a chain of compute
pipelines (`pipeline.ts`), each with an explicit bind group layout built from
the `kinds` of its spec by `computeBufferEntries`.

- A binding added to a shader is added to its `kinds` too.
- `__test__/shaders.test.ts` compiles the pitch shaders and fails on a compiler
  error.

## Measuring the pitch line

```sh
yarn workspace @musetric/spectrogram measure:pitch all --audio <file|dir>
```

`scripts/measurePitch.ts` scores the tracker against the neural reference
`musetric-pitch` of [musetric/lab](https://github.com/musetric/lab): the
accuracy (`src/__test__/pitchAccuracy.es.ts`), the line as a singer sees it
(`src/__test__/pitchLine.es.ts`) and the worst 5 s windows, into `tmp/pitch`.
A call without a stage prints the stages, `perf` among them, and the options.
It is run by hand, never in CI, with `ffmpeg` on `PATH`, in headless Chromium
under Vitest (`vitest.pitch.config.ts`), which the package skips on Linux.
