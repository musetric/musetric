# @musetric/ai

Audio AI package: the browser executor bundle for the gpu page and the shared
model/runtime code it loads. It has no node API.

The executor bundle (`src/service`, entry `browserEntry.ts`) runs on a hidden
executor page hosted by the rust core: it takes jobs over the core's
websocket, fetches model files from the core's model cache over http, runs
them with `onnxruntime-web` and uploads the results. The models are pinned in
`packages/server/src/analysis/models.rs`.

It serves separation (Mel-Band RoFormer and MDX cores), transcription (Whisper
large-v3 turbo through `@huggingface/transformers`), chords, rhythm and key
(S-KEY), all on WebGPU except the key, and the voice range from the pitch
tracker of `@musetric/spectrogram`, without a model.

## Rules

- The package does not depend on `@musetric/api`; the types of its results
  are declared next to the code that builds them.
- Sessions whose tensors meet, such as Whisper's `cross_kv` graph and its
  decoder, ask `getMusetricWebGpuDevice` (`src/runtime/webgpuDevice.ts`) for
  the same `subgroups` flag; Whisper asks without it (`whisperDeviceOptions`).
- Whatever serves model files to the executor sends `content-length`.
- `src/runtime/whisper` calls `model.generate` only on windows it cuts itself,
  `windowsPerBatch` at a time, never on the pipeline's long-form chunking, and
  with the language `resolveLanguage` picks once per track
  (`src/transcription/transcribePipeline.ts`).

## Decisions it follows

- Every model runs in this page, never natively ([R-8](https://github.com/musetric/headquarters/blob/main/decisions/r08-models-run-in-the-page.md)).
- A GPU defect is fixed by rewriting the graph, not by a CPU fallback; S-KEY is the one model on wasm ([R-9](https://github.com/musetric/headquarters/blob/main/decisions/r09-no-cpu-fallback.md)).
- One inference at a time: the executor page holds the Web Lock `musetric-executor` (`src/service/browserExecutor.ts`) ([R-20](https://github.com/musetric/headquarters/blob/main/decisions/r20-one-inference-at-a-time.md)).
- The WebGPU device is created here and handed to `onnxruntime-web`, and `src/runtime/gpuPacer.ts` paces its queue ([R-24](https://github.com/musetric/headquarters/blob/main/decisions/r24-own-webgpu-device.md)).
- Transcription runs on `@huggingface/transformers` ([R-26](https://github.com/musetric/headquarters/blob/main/decisions/r26-whisper-on-transformers-js.md)).

## Parity run

```sh
yarn workspace @musetric/ai measure:parity all --devices pc,<name>=<adb serial>
```

It follows each step from the model author's torch code to the executor on
the desktop Chrome and on each phone over `adb reverse`, and writes
`tmp/parity/report.md`; without a stage it prints its stages and options. Run
it by hand when a model, its pin or `onnxruntime-web` changes, never in CI.

- The references come from `musetric-parity` of
  [musetric/lab](https://github.com/musetric/lab), the cases from
  `scripts/parityCases.json`.
- Each boundary is scored against `scripts/parityChecks.json`; a phone must
  stay within `marginDb` of the desktop.
