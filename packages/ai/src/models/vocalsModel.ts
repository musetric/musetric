const nFft = 2048;
const hop = 441;
const frames = 1100;
const packedBins = (nFft / 2 + 1) * 2;

export const vocalsModel = {
  modelId: 'musetric/vocal-separation-roformer-onnx',
  revision: '4f72f5b57d84409be3120e836dba5d2992235be1',
  files: {
    model: 'syhft_core_t1100.onnx',
    data: 'syhft_core_t1100.onnx.data',
  },
  sha256: {
    model: '8571b17884e582bc3d3f152c37039bff2993a4cbacbb81a788b4bad021bc14a3',
    data: '648db04fce69e556bc1fb08486ffd7f7ac50d370b1c6026e42ffea9cd621a7ed',
  },
  inputName: 'stft_repr',
  outputName: 'masks',
  minStorageBuffersPerShaderStage: 9,
  inputShape: [1, packedBins, frames, 2] as const,
  outputShape: [1, packedBins, frames, 2] as const,
  sampleRate: 44100,
  channels: 2,
  nFft,
  hop,
  frames,
  chunkSamples: hop * (frames - 1),
} as const;
