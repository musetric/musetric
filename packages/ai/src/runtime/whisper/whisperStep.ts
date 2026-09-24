import * as ort from 'onnxruntime-web/webgpu';

const branchSelector = 'use_cache_branch';
const encoderStates = 'encoder_hidden_states';
const firstPast = 'past_key_values.0.decoder.key';
const crossAttentionPrefix = 'cross_attentions.';

type StepFeeds = Record<string, ort.Tensor>;

type StepOutputs = Record<string, ort.Tensor>;

export type StepSession = {
  run: (feeds: StepFeeds, ...rest: unknown[]) => Promise<StepOutputs>;
  inputNames: readonly string[];
};

export const isFlatStep = (session: StepSession): boolean =>
  !session.inputNames.includes(branchSelector);

export const isFirstStep = (feeds: StepFeeds): boolean =>
  feeds[firstPast].dims[2] === 0;

const tokenColumn = (ids: ort.Tensor, column: number): ort.Tensor => {
  const [batch, tokens] = ids.dims;
  if (!(ids.data instanceof BigInt64Array)) {
    throw new Error('whisper step: token ids are not int64');
  }
  const data = new BigInt64Array(batch);
  for (let row = 0; row < batch; row++) {
    data[row] = ids.data[row * tokens + column];
  }
  return new ort.Tensor('int64', data, [batch, 1]);
};

const concatTokens = (parts: ort.Tensor[]): ort.Tensor => {
  const [batch, heads, , positions] = parts[0].dims;
  const tokens = parts.length;
  const data = new Float32Array(batch * heads * tokens * positions);
  for (const [token, part] of parts.entries()) {
    if (!(part.data instanceof Float32Array)) {
      throw new Error('whisper step: attention weights are not float32');
    }
    for (let slab = 0; slab < batch * heads; slab++) {
      data.set(
        part.data.subarray(slab * positions, (slab + 1) * positions),
        (slab * tokens + token) * positions,
      );
    }
  }
  return new ort.Tensor('float32', data, [batch, heads, tokens, positions]);
};

const selfCache = (name: string): boolean =>
  name.startsWith('past_key_values.') && name.includes('.decoder.');

const crossCache = (name: string): boolean =>
  name.startsWith('past_key_values.') && name.includes('.encoder.');

const presentOf = (past: string): string =>
  past.replace('past_key_values.', 'present.');

const release = (
  tensors: Iterable<ort.Tensor>,
  keep: Set<ort.Tensor>,
): void => {
  for (const tensor of tensors) {
    if (!keep.has(tensor) && tensor.location === 'gpu-buffer') {
      tensor.dispose();
    }
  }
};

export const routeFirstStep = (
  step: StepSession,
  cross: ort.InferenceSession,
): void => {
  const run = step.run.bind(step);
  step.run = async (feeds, ...rest) => {
    if (!isFirstStep(feeds)) {
      return run(feeds, ...rest);
    }
    const crossValues = await cross.run({
      [encoderStates]: feeds[encoderStates],
    });
    const ids = feeds.input_ids;
    const [, tokens] = ids.dims;
    let past: StepFeeds = Object.fromEntries(
      Object.entries(feeds).filter((entry) => selfCache(entry[0])),
    );
    const crossFeeds = Object.fromEntries(
      Object.keys(feeds)
        .filter(crossCache)
        .map((name) => [name, crossValues[presentOf(name)]]),
    );
    const attentions = new Map<string, ort.Tensor[]>();
    let last: StepOutputs = {};
    for (let token = 0; token < tokens; token++) {
      const outputs = await run(
        {
          ...feeds,
          ...past,
          ...crossFeeds,
          input_ids: tokenColumn(ids, token),
        },
        ...rest,
      );
      for (const [name, tensor] of Object.entries(outputs)) {
        if (name.startsWith(crossAttentionPrefix)) {
          attentions.set(name, [...(attentions.get(name) ?? []), tensor]);
        }
      }
      const next: StepFeeds = Object.fromEntries(
        Object.keys(past).map((name) => [name, outputs[presentOf(name)]]),
      );
      if (token > 0) {
        release(Object.values(past), new Set());
      }
      if (token < tokens - 1) {
        release(
          Object.entries(outputs)
            .filter((entry) => !entry[0].startsWith(crossAttentionPrefix))
            .filter((entry) => !entry[0].includes('.decoder.'))
            .map((entry) => entry[1]),
          new Set(),
        );
      }
      past = next;
      last = outputs;
    }
    const kept = new Set(Object.values(crossValues));
    release(
      Object.entries(last)
        .filter((entry) => entry[0].includes('.encoder.'))
        .map((entry) => entry[1]),
      kept,
    );
    return {
      ...last,
      ...Object.fromEntries(
        Object.keys(crossValues).map((name) => [name, crossValues[name]]),
      ),
      ...Object.fromEntries(
        [...attentions].map((entry) => [entry[0], concatTokens(entry[1])]),
      ),
    };
  };
};
