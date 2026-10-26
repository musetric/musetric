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
