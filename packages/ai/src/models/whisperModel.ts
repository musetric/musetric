export const whisperModel = {
  modelId: 'musetric/whisper-large-v3-turbo-onnx',
  revision: 'da27c0c3e917574b5541f71251abfd2c1aabb3a1',
  files: [
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
    'decoder_model_merged_fp16.onnx',
  ],
  sha256: {
    'config.json':
      '3895aac9c18e541502ded9bf0f4c31cbe25a3387ef88ffdc85214e43acc0ca57',
    'generation_config.json':
      '0392ccf797bca2bff1600477ed6fb71d367b428f3da626c6d3c8dbd82c58ae44',
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
      'd27943f0f3ee4fdfc33241a64d68fffd40ce0f2344ee21f73d37abac9ebd1a43',
    'decoder_model_merged_fp16.onnx':
      '6497641a50badd9fd90f58907fe74ad43048a874b8288e2039f26ce01a15ef3e',
  },

  dtype: {
    encoder_model: 'q4',
    decoder_model_merged: 'fp16',
  },
  chunkLengthSeconds: 30,
  strideLengthSeconds: 5,
} as const;

export const resolveWhisperModelUrl = (file: string): string =>
  `https://huggingface.co/${whisperModel.modelId}/resolve/${whisperModel.revision}/${file}`;
