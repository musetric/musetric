# Third-party Notices

This project includes or adapts portions of the following third-party works.

## Ultimate Vocal Remover GUI / MDX-Net

- Source: https://github.com/Anjok07/ultimatevocalremovergui
- Usage: UVR MDX-Net karaoke model, model parameters, tensor layout, and demix overlap-add behavior reimplemented in TypeScript/WebGPU.
- Local files: `packages/ai/src/models/leadBackingModel.ts`, `packages/ai/src/separation/separateLeadBacking.ts`, `packages/ai/src/runtime/leadBacking/leadBackingRuntime.ts`, `packages/ai/src/runtime/leadBacking/packShader.ts`, `packages/ai/src/runtime/leadBacking/unpackShader.ts`.
- License: MIT, as stated in the upstream README.
- Credit: Ultimate Vocal Remover GUI / UVR developers, including Anjok07 and aufr33; original MDX-Net AI code credited upstream to Kuielab and Woosung Choi.

The upstream repository README asks third-party application developers who use UVR models to credit UVR and its developers.

## BS-RoFormer / Mel-Band RoFormer

- Source: https://github.com/lucidrains/BS-RoFormer
- Usage: Mel-Band RoFormer source-separation architecture and model contract used by the vocal separation ONNX pipeline.
- Local files: `packages/ai/src/models/vocalsModel.ts`, `packages/ai/src/separation/separateVocals.ts`, `packages/ai/src/runtime/vocals/vocalsRuntime.ts`, `packages/ai/src/runtime/vocals/applyMasksShader.ts`, `packages/ai/src/runtime/vocals/packShader.ts`.
- License: MIT.
- License source: upstream `LICENSE`.

MIT License

Copyright (c) 2023 Phil Wang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Musetric Vocal Separation RoFormer ONNX

- Source: https://huggingface.co/musetric/vocal-separation-roformer-onnx
- Usage: WebGPU-ready ONNX vocal separation model and external data file.
- Local files: `packages/ai/src/models/vocalsModel.ts`, `packages/ai/src/service/modelCache.node.ts`, `packages/ai/src/service/browserEntry.ts`, `packages/ai/src/service/headlessAiService.node.ts`, `packages/ai/src/runtime/vocals/vocalsRuntime.ts`.
- License: MIT.
- License source: Hugging Face model card metadata.

## Musetric Toolkit

- Source: https://github.com/popelenkow/musetric-toolkit
- Usage: Companion CLI for running audio processing workflows and worker scripts.
- Local files: `packages/toolkit/`.
- License: MIT.

MIT License

Copyright (c) 2025 Vladlen Popelenkov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
