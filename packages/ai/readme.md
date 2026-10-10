# @musetric/ai

Audio AI package: the browser executor bundle for the gpu page and the shared
model/runtime code it loads.

The executor bundle (`src/service`, entry `browserEntry.ts`) runs on a hidden
executor page hosted by the rust core: it connects to the core over the job
websocket, fetches model files from the core's http host, runs the ONNX models
on WebGPU (`onnxruntime-web`), reports progress, and uploads results back.

The analyses it serves:

- **Separation** — stereo stems for lead vocal, backing vocal, instrumental
  (Mel-Band RoFormer + MDX cores via `onnxruntime-web`).
- **Transcription** — word-timestamped lyric segments (Whisper large-v3 q4 via
  `@huggingface/transformers`, which runs on `onnxruntime-web`).
- **Chords, key, rhythm** — the smaller webgpu analyses.
- **Voice range** — the pitch range of the lead and the level of its upper
  bands, which the notes and spectrum views open on (the pitch tracker of
  `@musetric/spectrogram` on WebGPU, no model).

Both model families are fetched from the core's model cache (downloaded and
sha256-verified by the rust side from Hugging Face, `musetric/*-onnx`). The
package intentionally does not expose a node API: the core is rust, and the
executor runs in the browser.

## Parity run

`yarn workspace @musetric/ai measure:parity <prepare|run|compare|all>` follows
each step from the model author's torch code to the executor on a device, run
by hand when a model, its pin or `onnxruntime-web` changes, never in CI.

- `prepare` downloads the pinned models and the cases of
  `scripts/parityCases.json`, and writes each case's reference with
  `musetric-parity` from musetric-toolkit.
- `run --devices pc,<name>=<adb serial>` opens a page on the desktop Chrome and
  on each phone over `adb reverse`; it runs the models on wasm and WebGPU and
  the executor's own runtime, and saves every stage boundary.
- `compare` scores each boundary against `scripts/parityChecks.json` and writes
  `report.md`; a phone must stay within `marginDb` of the desktop.

Outputs go to `packages/ai/tmp/parity` (`--out`).
