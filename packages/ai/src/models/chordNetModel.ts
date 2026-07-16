const modelId = 'musetric/chordmini-onnx';
const revision = 'main';

const files = [
  'config.json',
  'chordnet.onnx',
  'cqt-plan.bin',
  'cqt-plan.manifest.json',
] as const;

export const chordNetModel = {
  modelId,
  revision,
  repo: `https://huggingface.co/${modelId}`,
  files,
  sha256: {
    'config.json':
      '1f26c11ebea51ec08f12e813eb213a729fa0ecc407ac7632dfdc7bad67e65aa4',
    'chordnet.onnx':
      '9a6570bf611cdc3f2c36286307af46fb94927fe7f6a2bc22a87c0ebf5f6c082e',
    'cqt-plan.bin':
      'c31f0a6fd2d582d753be6628b5daecdee58acba53cba93b2bc2b5c75dee2ba48',
    'cqt-plan.manifest.json':
      '522b178e4f6e8ae5b6bf63b8e2f1a615fe2398592e27f7d9e3e219810081019f',
  },
  sampleRate: 22050,
  hopLength: 2048,
  frameDuration: 2048 / 22050,
  inputName: 'features',
  outputName: 'logits',
  sequenceLength: 108,
  inputBins: 144,
  chordCount: 170,
  smoothingKernel: 9,
} as const;

export const resolveChordNetModelUrl = (file: string): string =>
  `${chordNetModel.repo}/resolve/${chordNetModel.revision}/${file}`;
