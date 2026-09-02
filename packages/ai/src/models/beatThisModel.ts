export const beatThisModel = {
  modelId: 'musetric/beat-this-onnx',
  revision: '45ba973e6c1fbee08a8a75b485e1c5adf45d2bc4',
  files: ['config.json', 'beat_this.onnx', 'mel-filterbank.bin'],
  sha256: {
    'config.json':
      '56cc961ddc588c57787c20c01ec6ab483b23af1049e65bd33d599a81803acd69',
    'beat_this.onnx':
      '3472a3957f25f4c3a2d68b46ee4b784e065a8ebd46132796c1a6bdd817229253',
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
