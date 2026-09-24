import {
  LogitsProcessor,
  LogitsProcessorList,
  Tensor,
} from '@huggingface/transformers';

export type BatchTensor = {
  dims: number[];
  data: Float32Array;
  slice: (...ranges: number[][]) => BatchTensor;
};

export const asBatchTensor = (value: unknown): BatchTensor => {
  if (
    value instanceof Object &&
    'dims' in value &&
    Array.isArray(value.dims) &&
    'data' in value &&
    value.data instanceof Float32Array
  ) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return value as BatchTensor;
  }
  throw new Error('whisper batch: expected a float tensor');
};

export const stack = (
  items: Float32Array[],
  dims: readonly number[],
): Tensor => {
  const data = new Float32Array(items.length * items[0].length);
  for (const [index, item] of items.entries()) {
    data.set(item, index * item.length);
  }
  return new Tensor('float32', data, [items.length, ...dims.slice(1)]);
};

export const endAtFirstEnd = (
  tokens: readonly (number | bigint)[],
  end: number,
): number => {
  const index = tokens.findIndex((token) => Number(token) === end);
  return index < 0 ? tokens.length : index + 1;
};

export const holdFinished = (end: number): LogitsProcessorList => {
  const hold = new LogitsProcessor();
  hold._call = (inputIds: bigint[][], logits: unknown) => {
    const rows = asBatchTensor(logits);
    const width = rows.data.length / rows.dims[0];
    for (const [row, ids] of inputIds.entries()) {
      if (!ids.some((id) => Number(id) === end)) {
        continue;
      }
      const values = rows.data.subarray(row * width, (row + 1) * width);
      values.fill(-Infinity);
      values[end] = 0;
    }
    return logits;
  };
  const list = new LogitsProcessorList();
  list.push(hold);
  return list;
};

const wholeAxes = (tensor: BatchTensor): number[][] =>
  tensor.dims.slice(1).map((size) => [0, size]);

type EncoderPreparation = {
  inputs_tensor: unknown;
  model_inputs: Record<string, unknown>;
  model_input_name: string;
  generation_config: unknown;
};

type TimestampOutputs = {
  sequences: BatchTensor;
  cross_attentions: BatchTensor[][];
};

export type BatchedGeneration = {
  _prepare_encoder_decoder_kwargs_for_generation: (
    preparation: EncoderPreparation,
  ) => Promise<Record<string, unknown>>;
  _extract_token_timestamps: (
    outputs: TimestampOutputs,
    heads: unknown,
    frames: number | undefined,
    ...rest: unknown[]
  ) => BatchTensor;
};

const encodePerWindow = (
  model: BatchedGeneration,
  rowFeatures: unknown[],
): void => {
  const prepare =
    model._prepare_encoder_decoder_kwargs_for_generation.bind(model);
  model._prepare_encoder_decoder_kwargs_for_generation = async (
    preparation,
  ) => {
    if (rowFeatures.length === 0) {
      return prepare(preparation);
    }
    const states: Float32Array[] = [];
    let stateDims: readonly number[] = [];
    let prepared: Record<string, unknown> = {};
    for (const one of rowFeatures) {
      prepared = await prepare({
        ...preparation,
        inputs_tensor: one,
        model_inputs: { ...preparation.model_inputs, input_features: one },
      });
      const state = asBatchTensor(prepared.encoder_outputs);
      states.push(state.data);
      stateDims = state.dims;
    }
    return {
      ...preparation.model_inputs,
      ...prepared,
      input_features: preparation.model_inputs.input_features,
      encoder_outputs: stack(states, stateDims),
    };
  };
};

const timePerRow = (model: BatchedGeneration, rowFrames: number[]): void => {
  const extract = model._extract_token_timestamps.bind(model);
  model._extract_token_timestamps = (outputs, heads, frames, ...rest) => {
    const [count] = outputs.sequences.dims;
    if (count === 1) {
      return extract(outputs, heads, frames, ...rest);
    }
    const rows: Float32Array[] = [];
    for (let index = 0; index < count; index++) {
      const row = extract(
        {
          ...outputs,
          sequences: outputs.sequences.slice(
            [index, index + 1],
            ...wholeAxes(outputs.sequences),
          ),
          cross_attentions: outputs.cross_attentions.map((step) =>
            step.map((layer) =>
              layer.slice([index, index + 1], ...wholeAxes(layer)),
            ),
          ),
        },
        heads,
        rowFrames[index] ?? frames,
        ...rest,
      );
      rows.push(row.data);
    }
    return asBatchTensor(stack(rows, [count, rows[0].length]));
  };
};

export type BatchRows = { frames: number[]; features: unknown[] };

export const enableBatchedGeneration = (
  model: BatchedGeneration,
): BatchRows => {
  const rows: BatchRows = { frames: [], features: [] };
  encodePerWindow(model, rows.features);
  timePerRow(model, rows.frames);
  return rows;
};
