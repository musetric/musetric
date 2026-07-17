const nFft = 2048;
const hop = 441;
const frames = 1101;
const packedBins = (nFft / 2 + 1) * 2;

// Mel-Band RoFormer / SYHFT vocal separation ONNX artifact and tensor contract.
// See thirdPartyNotices.md for source and license details.
export const vocalsModel = {
  repo: 'https://huggingface.co/musetric/vocal-separation-roformer-onnx',
  revision: 'main',
  files: {
    model: 'syhft_core_folded_fp16_webgpu.onnx',
    data: 'syhft_core_folded_fp16_webgpu.onnx.data',
  },
  sha256: {
    model: 'e22f33a2895f8cc244e28494197a7c77d7a65101d0aa00dbafc626ed16a0cbdb',
    data: 'b08cfc80905e3560a4dd5d30f641299a47dd96d309ebbe9524d9d6c9d2a0356f',
  },
  inputName: 'stft_repr',
  outputName: 'masks',
  inputShape: [1, packedBins, frames, 2] as const,
  outputShape: [1, packedBins, frames, 2] as const,
  sampleRate: 44100,
  channels: 2,
  nFft,
  hop,
  frames,
  chunkSamples: hop * (frames - 1),
} as const;

export const resolveVocalsModelUrl = (file: string): string =>
  `${vocalsModel.repo}/resolve/${vocalsModel.revision}/${file}`;
