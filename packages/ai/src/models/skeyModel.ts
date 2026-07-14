const modelId = 'musetric/skey-onnx';
const revision = 'main';

const files = ['config.json', 'skey.onnx'] as const;

export const skeyModel = {
  modelId,
  revision,
  repo: `https://huggingface.co/${modelId}`,
  files,
  sha256: {
    'config.json':
      '20be1e139e1b05dea4bae2e2dde717d593c10c30bb38b300aeedc6693be88a52',
    'skey.onnx':
      '5113c1378c1007c8559fcb767593366ba9794397b060535eb80a113db50530fc',
  },
  sampleRate: 22050,
  inputName: 'audio',
  outputName: 'probs',
} as const;

export const resolveSkeyModelUrl = (file: string): string =>
  `${skeyModel.repo}/resolve/${skeyModel.revision}/${file}`;
