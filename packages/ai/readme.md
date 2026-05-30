# @musetric/ai

Backend-only audio separation package used by `@musetric/backend`.

The public entrypoint is `@musetric/ai/node`. It reads one source audio file,
downloads or reuses the required ONNX models, runs separation through a
headless WebGPU page, and writes FLAC masters for:

- lead vocal
- backing vocal
- instrumental

The package intentionally does not expose a standalone browser API. Browser and
WebGPU files under `src/service` and `src/runtime` are internal implementation
details of the backend worker path.
