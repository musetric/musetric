const modelId = 'musetric/whisper-large-v3-onnx';
const revision = 'main';

const files = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'vocab.json',
  'merges.txt',
  'normalizer.json',
  'encoder_model_q4.onnx',
  'decoder_model_merged_q4.onnx',
] as const;

export const whisperModel = {
  modelId,
  revision,
  repo: `https://huggingface.co/${modelId}`,
  files,
  sha256: {
    'config.json':
      '806941fa1df73caf5900e06132a4c12b61fd86259b228f0f2fae69a11069f1cf',
    'generation_config.json':
      '93d43cd27dc1a5ac3aa593c60939d1339f719075823fa2adac88ac963491fff2',
    'preprocessor_config.json':
      '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711',
    'tokenizer.json':
      'b3c8202bbf06d8ee4232c5984baa563784ac4737e2e7fdc42fa180200d3cfcdb',
    'tokenizer_config.json':
      '844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389',
    'special_tokens_map.json':
      'baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74',
    'added_tokens.json':
      '3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0',
    'vocab.json':
      'e2aa043ef015641d363d8288e7c241c85e36a5c761fb303598e0710233344387',
    'merges.txt':
      '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6',
    'normalizer.json':
      'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd',
    'encoder_model_q4.onnx':
      'f142de7eb5928893e57546906817e7387157609cbc2a36ea7859d336a8d568d0',
    'decoder_model_merged_q4.onnx':
      '7b68ff4833299ca0e21cae70f4b9f9ada15a01644813524b7f29c160bda02e2b',
  },

  dtype: {
    encoder_model: 'q4',
    decoder_model_merged: 'q4',
  },
  chunkLengthSeconds: 30,
  strideLengthSeconds: 5,
} as const;

export const resolveWhisperModelUrl = (file: string): string =>
  `${whisperModel.repo}/resolve/${whisperModel.revision}/${file}`;
