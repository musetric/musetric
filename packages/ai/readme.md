# @musetric/ai

Backend-only audio AI package used by `@musetric/backend`.

The public entrypoint is `@musetric/ai/node`. It reads one source audio file,
downloads (and checksum-verifies) or reuses the required ONNX models, runs the
model through a headless WebGPU page, and writes results:

- **Separation** — FLAC masters for lead vocal, backing vocal, instrumental
  (Mel-Band RoFormer + MDX cores via `onnxruntime-web`).
- **Transcription** — word-timestamped lyric segments (Whisper large-v3 q4 via
  `@huggingface/transformers`, which runs on `onnxruntime-web`).

Both paths fetch their ONNX from Hugging Face (`musetric/*-onnx`) with the same
Node-side download + sha256 verification, then run WebGPU-only in a headless
Chromium page. The package intentionally does not expose a standalone browser
API. Browser and WebGPU files under `src/service` and `src/runtime` are internal
implementation details of the backend worker path.
