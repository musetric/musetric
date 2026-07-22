const nFft = 5120;
const hop = 1024;
const dimF = 2048;
const dimT = 256;

export const leadBackingModel = {
  sourceUrl:
    'https://huggingface.co/AI4future/RVC/resolve/main/UVR_MDXNET_KARA_2.onnx',
  file: 'UVR_MDXNET_KARA_2.onnx',
  relativePath: 'uvr_mdxnet_kara_2/UVR_MDXNET_KARA_2.onnx',
  sha256: 'bf32e15105a09c0f7dddd2b67346146334d6f3ecb399ed7638eba2ab07cbf5f4',
  inputName: 'input',
  outputName: 'output',
  inputShape: [1, 4, dimF, dimT] as const,
  outputShape: [1, 4, dimF, dimT] as const,
  compensate: 1.065,
  channels: 2,
  nFft,
  hop,
  dimF,
  dimT,
  chunkSamples: hop * (dimT - 1),
} as const;
