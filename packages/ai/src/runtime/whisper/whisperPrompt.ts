const maxDecoderPositions = 448;

export type PromptConfig = {
  lang_to_id?: Record<string, number>;
  task_to_id?: Record<string, number>;
  decoder_start_token_id?: number;
  prev_sot_token_id?: number;
};

export type PromptTokenizer = {
  encode: (text: string, options?: Record<string, unknown>) => number[];
};

export type PromptRequest = {
  config: PromptConfig;
  tokenizer: PromptTokenizer;
  language: string;
  prompt: string;
  maxNewTokens: number;
};

export type PromptedGeneration = {
  decoder_input_ids: number[];
  max_new_tokens: number;
};

export const promptedGeneration = (
  request: PromptRequest,
): PromptedGeneration => {
  const { config, tokenizer, language, prompt, maxNewTokens } = request;
  const languageToken = config.lang_to_id?.[`<|${language}|>`];
  const taskToken = config.task_to_id?.transcribe;
  if (
    config.prev_sot_token_id === undefined ||
    config.decoder_start_token_id === undefined ||
    languageToken === undefined ||
    taskToken === undefined
  ) {
    throw new Error(`whisper decode: no prompt tokens for ${language}`);
  }
  const start = [
    config.prev_sot_token_id,
    ...tokenizer.encode(` ${prompt}`, { add_special_tokens: false }),
    config.decoder_start_token_id,
    languageToken,
    taskToken,
  ];
  return {
    decoder_input_ids: start,
    max_new_tokens: Math.min(maxNewTokens, maxDecoderPositions - start.length),
  };
};
