# @musetric/ai

Audio AI package: the browser executor bundle for the gpu page and the shared
model/runtime code it loads.

The executor bundle (`src/service`, entry `browserEntry.ts`) runs on a hidden
executor page hosted by the rust core: it connects to the core over the job
websocket, fetches model files from the core's http host, runs the ONNX models
with `onnxruntime-web`, on WebGPU except the key model, which runs on its wasm
provider, reports progress, and uploads results back.

The analyses it serves:

- **Separation** — stereo stems for lead vocal, backing vocal, instrumental
  (Mel-Band RoFormer + MDX cores via `onnxruntime-web`).
- **Transcription** — word-timestamped lyric segments (Whisper large-v3 turbo,
  a q4 encoder and an fp16 decoder, via `@huggingface/transformers`, which runs
  on `onnxruntime-web`).
- **Chords, rhythm** — the smaller analyses on WebGPU.
- **Key** — S-KEY on the wasm provider of `onnxruntime-web`, the one model off
  the GPU (decision
  [R-9](https://github.com/musetric/headquarters/blob/main/decisions/r09-no-cpu-fallback.md)).
- **Voice range** — the pitch range of the lead and the level of its upper
  bands, which the notes and spectrum views open on (the pitch tracker of
  `@musetric/spectrogram` on WebGPU, no model).

Both model families are fetched from the core's model cache (downloaded and
sha256-verified by the rust side from Hugging Face, `musetric/*-onnx`). The
package intentionally does not expose a node API: the core is rust, and the
executor runs in the browser.

## Boundaries

The package does not depend on `@musetric/api`: the types of its results are
declared here, next to the code that builds them, and the API contract stays
out of the algorithms.

## Runtime

- Each `onnxruntime-web` session picks its storage buffer cache. The models of
  fixed shapes, separation (`src/runtime/stftInference.ts`) and Beat This!
  (`src/runtime/rhythm/beatThisGpuRuntime.ts`), ask for `simple`, which reuses
  a released buffer only for a request of the same size and so holds less GPU
  memory than size buckets. Whisper keeps the default `bucket`: its key-value
  cache grows on every step, and under `simple` the buffers of each step would
  be new sizes that are never reused.
- There is one `GPUDevice` per value of the `subgroups` feature
  (`getMusetricWebGpuDevice` in `src/runtime/webgpuDevice.ts`). Whisper asks
  for its device without subgroups (`whisperDeviceOptions`), the other models
  with them, so sessions whose tensors meet, such as Whisper's `cross_kv`
  graph and its decoder, pass the same flag.
- The host sends no COOP and COEP headers, so the executor page is not
  cross-origin isolated, and `onnxruntime-web` runs its wasm provider on one
  thread: the key model, and the nodes a WebGPU session keeps on the CPU. The
  parity server sends them (`src/__test__/parity/parityServer.ts`).
- Whatever serves model files to the executor sends `content-length`, as the
  host and the parity server do: without it, transformers.js grows its receive
  buffer by a copy on every chunk (`readResponse` of
  `@huggingface/transformers`).

## Transcription

`src/runtime/whisper` drives transformers.js below its pipeline:

- It calls `model.generate` on windows the package cuts itself, up to four in
  one batch (`windowsPerBatch` in `whisperRuntime.ts`), never on the
  pipeline's own long-form chunking.
- The language is chosen once per track, by a vote of `detectLanguage` over
  the logits after `<|startoftranscript|>` on its loudest windows
  (`resolveLanguage` in `src/transcription/transcribePipeline.ts`), and passed
  to every call: without it, transformers.js falls back to English.
- `max_new_tokens` follows the window's length, 12 tokens a second plus 32 and
  at most 400 (`whisperDecoder.ts`), so a decode that repeats itself stops
  near what the window can hold.
- Word times come from `return_token_timestamps`. The main pass also asks for
  timestamp tokens (`return_timestamps: true`); when its text collapses or is
  a known hallucination, a pass without them (`decodeAligned`,
  `return_timestamps: false`) is tried, and kept only when it finds more words
  and is neither a hallucination nor a loop.
- A batch of windows needs two overrides of transformers.js internals and a
  logits processor (`whisperBatch.ts`):
  `_prepare_encoder_decoder_kwargs_for_generation` runs the encoder once per
  window and stacks the outputs; `_extract_token_timestamps`, which in
  transformers.js 4 handles one row only, runs per row with that row's
  `num_frames`; and `holdFinished` keeps a row that has reached the end token
  on it while the other rows decode.

## Decisions it follows

The owner's decisions behind the executor, kept in
[headquarters](https://github.com/musetric/headquarters/tree/main/decisions):

- Every model runs in this page, never natively
  ([R-8](https://github.com/musetric/headquarters/blob/main/decisions/r08-models-run-in-the-page.md)).
- A GPU defect is fixed by rewriting the graph, not by a CPU fallback; S-KEY is
  the one model on wasm
  ([R-9](https://github.com/musetric/headquarters/blob/main/decisions/r09-no-cpu-fallback.md)).
- One inference at a time: the executor page holds the Web Lock
  `musetric-executor` (`src/service/browserExecutor.ts`)
  ([R-20](https://github.com/musetric/headquarters/blob/main/decisions/r20-one-inference-at-a-time.md)).
- The WebGPU device is created here and handed to `onnxruntime-web`, and
  `src/runtime/gpuPacer.ts` paces its queue
  ([R-24](https://github.com/musetric/headquarters/blob/main/decisions/r24-own-webgpu-device.md)).
- Transcription runs on `@huggingface/transformers`
  ([R-26](https://github.com/musetric/headquarters/blob/main/decisions/r26-whisper-on-transformers-js.md)).

## Parity run

`yarn workspace @musetric/ai measure:parity <prepare|run|compare|all>` follows
each step from the model author's torch code to the executor on a device, run
by hand when a model, its pin or `onnxruntime-web` changes, never in CI.

- `prepare` downloads the pinned models and the cases of
  `scripts/parityCases.json`, and writes each case's reference with
  `musetric-parity` from [musetric/lab](https://github.com/musetric/lab).
- `run --devices pc,<name>=<adb serial>` opens a page on the desktop Chrome and
  on each phone over `adb reverse`; it runs the models on wasm and WebGPU and
  the executor's own runtime, and saves every stage boundary.
- `compare` scores each boundary against `scripts/parityChecks.json` and writes
  `report.md`; a phone must stay within `marginDb` of the desktop.

Outputs go to `packages/ai/tmp/parity` (`--out`).
