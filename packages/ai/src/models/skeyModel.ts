export const skeyModel = {
  cacheDirName: 'skey-onnx',
  modelId: 'musetric/skey-onnx',
  revision: '9d90d2a9ff6679df1d64000f4fa750643f247643',
  files: ['config.json', 'skey.onnx'],
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
  `https://huggingface.co/${skeyModel.modelId}/resolve/${skeyModel.revision}/${file}`;
