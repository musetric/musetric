const nFft = 2048;
const hop = 441;
const frames = 1100;
const packedBins = (nFft / 2 + 1) * 2;

export const vocalsModel = {
  modelId: 'musetric/vocal-separation-roformer-onnx',
  revision: '98064f6e42af945316fd96261a18f1befe3a4536',
  files: {
    model: 'syhft_core_t1100.onnx',
    data: 'syhft_core_t1100.onnx.data',
  },
  sha256: {
    model: '8b624200ac9bfc76c38fbcc9dcde3901f307acd6ee7e95b5b0a6cb3022585758',
    data: '06b41c5798b3c44d514e74feca715a002031c26fa390fcea913ad01844fb7221',
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
  `https://huggingface.co/${vocalsModel.modelId}/resolve/${vocalsModel.revision}/${file}`;
