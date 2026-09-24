export const encoderPositions = 1500;

const crossAttentionPrefix = 'cross_attentions.';
const presentPrefix = 'present';
const packedStepOutput = 'step_outputs';

type OrtTensorClass = new (
  type: 'float32',
  data: Float32Array,
  dims: readonly number[],
) => unknown;

const tensorClassOf = (value: unknown): OrtTensorClass => {
  if (!(value instanceof Object)) {
    throw new Error('whisper decoder returned no tensor');
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return value.constructor as unknown as OrtTensorClass;
};

const packedData = (value: unknown): Float32Array => {
  if (
    value instanceof Object &&
    'data' in value &&
    value.data instanceof Float32Array
  ) {
    return value.data;
  }
  throw new Error('whisper decoder returned no packed step outputs');
};

type DecoderFeeds = { input_ids: { dims: readonly number[] } };

type DecoderOutputMetadata = {
  name: string;
  shape?: readonly (number | string)[];
};

export type DecoderSession = {
  run: (
    feeds: DecoderFeeds,
    ...rest: unknown[]
  ) => Promise<Record<string, unknown>>;
  outputNames: readonly string[];
  outputMetadata?: readonly DecoderOutputMetadata[];
};

const staticDim = (
  decoder: DecoderSession,
  name: string,
  axis: number,
): number | undefined => {
  const dim = decoder.outputMetadata?.find((entry) => entry.name === name)
    ?.shape?.[axis];
  return typeof dim === 'number' ? dim : undefined;
};

type PackedLayout = {
  vocabulary: number;
  heads: Map<string, number>;
};

const readPackedLayout = (
  decoder: DecoderSession,
  layers: readonly string[],
): PackedLayout | undefined => {
  if (!decoder.outputNames.includes(packedStepOutput)) {
    return undefined;
  }
  const vocabulary = staticDim(decoder, 'logits', 2);
  const heads = new Map<string, number>();
  for (const name of layers) {
    const count = staticDim(decoder, name, 1);
    if (count === undefined) {
      return undefined;
    }
    heads.set(name, count);
  }
  return vocabulary === undefined ? undefined : { vocabulary, heads };
};

type StepOutputsModel = {
  sessions: { decoder_model_merged: DecoderSession };
  generation_config: { alignment_heads?: number[][] };
};

export const fetchStepOutputs = (model: StepOutputsModel): void => {
  const decoder = model.sessions.decoder_model_merged;
  const layerIndices = new Set(
    (model.generation_config.alignment_heads ?? []).map((head) => head[0]),
  );
  const attentions = decoder.outputNames.filter((name) =>
    name.startsWith(crossAttentionPrefix),
  );
  const layers = attentions.filter((name) =>
    layerIndices.has(Number(name.slice(crossAttentionPrefix.length))),
  );
  const skipped = new Set(attentions.filter((name) => !layers.includes(name)));
  if (layers.length === 0) {
    return;
  }
  const packed = readPackedLayout(decoder, layers);
  const fetched = decoder.outputNames.filter((name) =>
    packed
      ? name.startsWith(presentPrefix) || name === packedStepOutput
      : !skipped.has(name) && name !== packedStepOutput,
  );
  const returned = decoder.outputNames.filter(
    (name) => name !== packedStepOutput,
  );
  const run = decoder.run.bind(decoder);
  decoder.run = async (feeds) => {
    const outputs = await run(feeds, fetched);
    const [batch, tokens] = feeds.input_ids.dims;
    const OrtTensor = tensorClassOf(outputs[fetched[0]]);
    const pieces = new Map<string, unknown>();
    if (packed) {
      const data = packedData(outputs[packedStepOutput]);
      let offset = batch * tokens * packed.vocabulary;
      pieces.set(
        'logits',
        new OrtTensor('float32', data.slice(0, offset), [
          batch,
          tokens,
          packed.vocabulary,
        ]),
      );
      for (const name of layers) {
        const heads = packed.heads.get(name) ?? 0;
        const length = batch * heads * tokens * encoderPositions;
        pieces.set(
          name,
          new OrtTensor('float32', data.slice(offset, offset + length), [
            batch,
            heads,
            tokens,
            encoderPositions,
          ]),
        );
        offset += length;
      }
    }
    for (const name of skipped) {
      pieces.set(
        name,
        new OrtTensor('float32', new Float32Array(batch * tokens), [
          batch,
          1,
          tokens,
          1,
        ]),
      );
    }
    return Object.fromEntries(
      returned.map((name) => [name, pieces.get(name) ?? outputs[name]]),
    );
  };
};
