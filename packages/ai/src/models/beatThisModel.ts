const modelId = 'musetric/beat-this-onnx';
const revision = 'main';

const files = ['config.json', 'beat_this.onnx', 'mel-filterbank.bin'] as const;

export const beatThisModel = {
  modelId,
  revision,
  repo: `https://huggingface.co/${modelId}`,
  files,
  sha256: {
    'config.json':
      '56cc961ddc588c57787c20c01ec6ab483b23af1049e65bd33d599a81803acd69',
    'beat_this.onnx':
      '078572af6ca47741e06a82d09525d13c793eaa8e311a8cf15e831dcd7e73f218',
    'mel-filterbank.bin':
      '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533',
  },
  sampleRate: 22050,
  nFft: 1024,
  hopLength: 441,
  fps: 50,
  melBins: 128,
  logMultiplier: 1000,
  chunkSize: 1500,
  borderSize: 6,
  peakRadius: 3,
  peakThreshold: 0,
  deduplicateWidth: 1,
  modelInputName: 'spect',
  beatOutputName: 'beat',
  downbeatOutputName: 'downbeat',
} as const;

export const resolveBeatThisModelUrl = (file: string): string =>
  `${beatThisModel.repo}/resolve/${beatThisModel.revision}/${file}`;
