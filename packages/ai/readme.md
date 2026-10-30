# @musetric/ai

Audio AI package: the browser executor bundle for the gpu page and the shared
model/runtime code it loads. It has no node API.

The executor bundle (`src/service`, entry `browserEntry.ts`) runs on a hidden
executor page hosted by the rust core: it takes jobs over the core's
websocket, fetches model files from the core's model cache over http, runs
them with `onnxruntime-web` and uploads the results. The models are pinned in
`packages/server/src/analysis/models.rs`.

It serves separation (a Mel-Band RoFormer core whose two masks give the vocals
and the backing vocals in one pass), transcription (Whisper large-v3 turbo
through `@huggingface/transformers`), chords, rhythm and key (S-KEY), all on
WebGPU except the key, and the voice range from the pitch tracker of
`@musetric/spectrogram`, without a model.

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
- It is the executor of [the product](https://github.com/musetric/headquarters/blob/main/product.md#how-it-is-built): the Web
  Lock `musetric-executor` (`src/service/browserExecutor.ts`) keeps one
  network running at a time, and S-KEY is its one model on wasm.
- A GPU defect is fixed by rewriting the graph, never by a CPU fallback
  ([principles](https://github.com/musetric/headquarters/blob/main/principles.md)).
- The WebGPU device is created here and handed to `onnxruntime-web`, and
  `src/runtime/gpuPacer.ts` paces its queue, so that a long queue of GPU work
  does not freeze a phone; `onnxruntime-web` is not patched for it.
- The vocal separation core runs as one graph, not in stages: its heavy
  projections, split into rows at export, keep the phone responsive with an
  identical output ([#957](https://github.com/musetric/musetric/issues/957) H7).
- Transcription stays on `@huggingface/transformers` and is not rewritten onto
  `onnxruntime-web`: the library holds the code that reached today's quality,
  from the tokenizer to the word times. Its price is its cache layout, reaching
  into its internals for the pacer, and a pinned version.

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
