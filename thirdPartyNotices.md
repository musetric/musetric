# Third-party Notices

This project includes or adapts portions of the following third-party works.

## Ultimate Vocal Remover GUI / MDX-Net

- Source: https://github.com/Anjok07/ultimatevocalremovergui
- Usage: UVR MDX-Net karaoke model, model parameters, tensor layout, and demix overlap-add behavior reimplemented in TypeScript/WebGPU.
- Local files: `packages/ai/src/models/leadBackingModel.ts`, `packages/ai/src/separation/separateLeadBacking.ts`, `packages/ai/src/runtime/leadBacking/leadBackingRuntime.ts`, `packages/ai/src/runtime/leadBacking/pack.wgsl.ts`, `packages/ai/src/runtime/leadBacking/unpack.wgsl.ts`.
- License: MIT, as stated in the upstream README.
- Credit: Ultimate Vocal Remover GUI / UVR developers, including Anjok07 and aufr33; original MDX-Net AI code credited upstream to Kuielab and Woosung Choi.

The upstream repository README asks third-party application developers who use UVR models to credit UVR and its developers.

## BS-RoFormer / Mel-Band RoFormer

- Source: https://github.com/lucidrains/BS-RoFormer
- Usage: Mel-Band RoFormer source-separation architecture and model contract used by the vocal separation ONNX pipeline.
- Local files: `packages/ai/src/models/vocalsModel.ts`, `packages/ai/src/separation/separateVocals.ts`, `packages/ai/src/runtime/vocals/vocalsRuntime.ts`, `packages/ai/src/runtime/vocals/applyMasks.wgsl.ts`, `packages/ai/src/runtime/vocals/pack.wgsl.ts`.
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

## ChordMini

- Source: https://github.com/ptnghia-j/ChordMini
- Usage: ChordNet "2E1D" chord recognizer. The `2e1d_model_best.pth` checkpoint is the basis of the ONNX classifier this project runs, and the 170-label chord vocabulary reproduces the index ordering of upstream `idx2voca_chord()`, which is the exported graph's output contract. The recursive constant-Q transform that produces its features, the temporal smoothing/argmax passes and the segment grouping are independent implementations.
- Local files: `packages/ai/src/chords/chordVocab.ts`, `packages/ai/src/models/chordNetModel.ts`, `packages/ai/src/runtime/chords/chordNetGpuRuntime.ts`, `packages/ai/src/service/chordNetModelCache.node.ts`.
- License: MIT.
- License source: upstream `LICENSE`.
- Vendoring details: the inference subset is vendored in `musetric-toolkit`; see its `thirdPartyNotices.md` and `musetric_toolkit/chords_audio/chordmini/NOTICE.md`.

MIT License

Copyright (c) 2026 ChordMini contributors

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

## Musetric ChordMini ONNX

- Source: https://huggingface.co/musetric/chordmini-onnx
- Usage: ChordNet classifier ONNX and its matched CQT plan, downloaded at runtime.
- Local files: `packages/ai/src/models/chordNetModel.ts`, `packages/ai/src/service/chordNetModelCache.node.ts`.
- License: MIT, inherited from the upstream ChordMini weights; conversion to ONNX does not change the weight license.
- License source: Hugging Face model card metadata.

## OpenAI Whisper

- Source: https://huggingface.co/openai/whisper-large-v3
- Usage: base speech-to-text weights behind lyric transcription. The `musetric/whisper-large-v3-onnx` export is an inference-only re-export of these weights with no fine-tuning.
- Local files: `packages/ai/src/models/whisperModel.ts`, `packages/ai/src/runtime/whisper/whisperRuntime.ts`, `packages/ai/src/service/whisperModelCache.node.ts`, `packages/ai/src/service/browserTranscribeEntry.ts`, `packages/ai/src/service/headlessTranscriptionService.node.ts`.
- License: Apache-2.0. Full text: https://www.apache.org/licenses/LICENSE-2.0
- License source: Hugging Face model card metadata of the repository the weights are downloaded from.

This notice covers the **weights only**. The local files above are this project's
own MIT code: they fetch the weights and drive them through
`@huggingface/transformers`, and the audio compaction, spectral chunking,
temperature ladder, collapse repair, hallucination/silence filtering and lyric
splitting around them are independent implementations carrying no upstream code.
Word timestamps come from Whisper's own cross-attention heads, so no third-party
forced aligner is involved.

Upstream is inconsistent about this and it is worth knowing: the
https://github.com/openai/whisper repository states that "Whisper's code and
model weights are released under the MIT License", while the Hugging Face model
card the weights are actually fetched from declares `apache-2.0`. This notice
follows the source the weights are downloaded from.

## Musetric Whisper large-v3 ONNX

- Source: https://huggingface.co/musetric/whisper-large-v3-onnx
- Usage: word-timestamped q4 ONNX export of Whisper large-v3 in the transformers.js layout, downloaded at runtime.
- Local files: `packages/ai/src/models/whisperModel.ts`, `packages/ai/src/service/whisperModelCache.node.ts`.
- License: Apache-2.0, inherited from the base weights; conversion to ONNX does not change the weight license.
- License source: Hugging Face model card metadata.

## S-KEY

- Source: https://github.com/deezer/skey
- Usage: S-KEY key detector (harmonic VQT + ChromaNet). The `skey.pt` checkpoint is the basis of the ONNX graph this project runs, and the 24-entry key map reproduces the index ordering of the upstream `key_map`, which is the exported graph's output contract. The audio decoding, peak normalization and argmax around the graph are independent implementations.
- Local files: `packages/ai/src/key/analyzeKey.node.ts`, `packages/ai/src/key/keyMap.ts`, `packages/ai/src/key/types.ts`, `packages/ai/src/models/skeyModel.ts`, `packages/ai/src/runtime/key/skeyRuntime.ts`, `packages/ai/src/service/skeyModelCache.node.ts`.
- License: MIT.
- License source: upstream `LICENSE`.
- Vendoring details: the inference subset is vendored in `musetric-toolkit`; see its `thirdPartyNotices.md`.

MIT License

Copyright (c) 2019-present, Deezer SA.

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

## Musetric S-KEY ONNX

- Source: https://huggingface.co/musetric/skey-onnx
- Usage: self-contained key-detection ONNX (`audio` → 24 key probabilities) and its `config.json` descriptor, downloaded at runtime.
- Local files: `packages/ai/src/models/skeyModel.ts`, `packages/ai/src/service/skeyModelCache.node.ts`.
- License: MIT, inherited from the upstream S-KEY weights; conversion to ONNX does not change the weight license.
- License source: Hugging Face model card metadata.

## Beat This!

- Source: https://github.com/CPJKU/beat_this
- Usage: Beat This! beat and downbeat tracker. The `final0` checkpoint is the basis of the ONNX graph this project runs, its mel filterbank is the basis of the WebGPU log-mel front end, and the chunking, aggregation and peak picking around them reproduce the upstream `split_piece`, `aggregate_prediction` and `minimal` `Postprocessor`, which are the exported graph's input and output contract. The audio decoding and the tempo/meter estimation are independent implementations.
- Local files: `packages/ai/src/rhythm/analyzeRhythm.node.ts`, `packages/ai/src/rhythm/beatPeaks.ts`, `packages/ai/src/rhythm/rhythmSummary.ts`, `packages/ai/src/rhythm/types.ts`, `packages/ai/src/models/beatThisModel.ts`, `packages/ai/src/runtime/rhythm/`, `packages/ai/src/service/beatThisModelCache.node.ts`, `packages/ai/src/service/browserRhythmEntry.ts`, `packages/ai/src/service/headlessRhythmService.node.ts`.
- License: MIT.
- License source: upstream `LICENSE`.

MIT License

Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria

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

## Musetric Beat This! ONNX

- Source: https://huggingface.co/musetric/beat-this-onnx
- Usage: rhythm ONNX graph (`beat_this.onnx`: spectrogram windows → beat/downbeat logits), the `mel-filterbank.bin` its WebGPU log-mel front end projects onto, and their `config.json` descriptor, downloaded at runtime.
- Local files: `packages/ai/src/models/beatThisModel.ts`, `packages/ai/src/service/beatThisModelCache.node.ts`.
- License: MIT, inherited from the upstream Beat This! weights; conversion to ONNX does not change the weight license.
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
