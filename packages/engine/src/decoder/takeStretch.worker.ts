import {
  createTimePitchProcessor,
  type TimePitchProcessor,
} from '@musetric/audio/player';

const blockFrameCount = 1024;
const unitTempoTolerance = 1e-6;

export const isUnitTempo = (tempo: number): boolean =>
  Math.abs(tempo - 1) < unitTempoTolerance;

const stretchBlock = (
  processor: TimePitchProcessor,
  output: Float32Array<ArrayBuffer>,
  position: number,
  source: Float32Array,
): number =>
  processor.process([output], (inputs, inputFrameOffset, inputFrameCount) => {
    const [input] = inputs;
    for (let offset = 0; offset < inputFrameCount; offset += 1) {
      input[offset] = source[position + inputFrameOffset + offset] ?? 0;
    }
  });

export type TakeStretch = {
  render: (samples: Float32Array, tempo: number) => Float32Array<ArrayBuffer>;
};

export const createTakeStretch = async (
  sampleRate: number,
): Promise<TakeStretch> => {
  const processor = await createTimePitchProcessor(sampleRate);

  return {
    render: (samples, tempo) => {
      const length = Math.round(samples.length * tempo);
      const output = new Float32Array(length);
      processor.reset();
      processor.setTempoRatio(1 / tempo);
      let position = 0;
      for (let start = 0; start < length; start += blockFrameCount) {
        const block = output.subarray(
          start,
          Math.min(length, start + blockFrameCount),
        );
        position += stretchBlock(processor, block, position, samples);
      }
      return output;
    },
  };
};
