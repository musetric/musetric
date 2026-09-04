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

Both model families are fetched from the core's model cache (downloaded and
sha256-verified by the rust side from Hugging Face, `musetric/*-onnx`). The
package intentionally does not expose a node API: the core is rust, and the
executor runs in the browser.
