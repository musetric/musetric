import {
  createTimeStretchWasmModule,
  type TimeStretchWasmModule,
} from './timeStretchWasmModule.js';

const getFrameCounts = (
  outputFrameCount: number,
  tempoRatio: number,
  inputFrameFraction: number,
) => {
  const rawInputFrameCount = outputFrameCount * tempoRatio;
  const inputFrameCount = Math.floor(rawInputFrameCount + inputFrameFraction);
  inputFrameFraction += rawInputFrameCount - inputFrameCount;

  return {
    inputFrameCount,
    inputFrameFraction,
  };
};

const tonalityLimitHz = 8000;

type TimePitchProcessorState = {
  bufferLength: number;
  channelCount: number;
  inputLatency: number;
  outputLatency: number;
  inputBuffers: Float32Array[];
  outputBuffers: Float32Array[];
};

const createState = (
  wasmModule: TimeStretchWasmModule,
  outputs: Float32Array[],
  sampleRate: number,
  outputFrameCount: number,
): TimePitchProcessorState => {
  wasmModule._presetDefault(outputs.length, sampleRate);
  wasmModule._reset();

  const inputLatency = wasmModule._inputLatency();
  const outputLatency = wasmModule._outputLatency();
  const bufferLength = Math.max(outputFrameCount, inputLatency + outputLatency);
  const pointer = wasmModule._setBuffers(outputs.length, bufferLength);
  const lengthBytes = bufferLength * Float32Array.BYTES_PER_ELEMENT;
  const inputBuffers: Float32Array[] = [];
  const outputBuffers: Float32Array[] = [];

  for (let channelIndex = 0; channelIndex < outputs.length; channelIndex += 1) {
    inputBuffers.push(
      new Float32Array(
        wasmModule.HEAP8.buffer,
        pointer + lengthBytes * channelIndex,
        bufferLength,
      ),
    );
    outputBuffers.push(
      new Float32Array(
        wasmModule.HEAP8.buffer,
        pointer + lengthBytes * (channelIndex + outputs.length),
        bufferLength,
      ),
    );
  }

  return {
    bufferLength,
    channelCount: outputs.length,
    inputLatency,
    outputLatency,
    inputBuffers,
    outputBuffers,
  };
};

type TimePitchProcessorInputFiller = (
  inputs: Float32Array[],
  inputFrameOffset: number,
  inputFrameCount: number,
) => void;

export type TimePitchProcessor = {
  process: (
    outputs: Float32Array[],
    fillInput: TimePitchProcessorInputFiller,
  ) => number;
  reset: () => void;
  setTransposeSemitones: (transposeSemitones: number) => void;
  setTempoRatio: (tempoRatio: number) => void;
};

export const createTimePitchProcessor = async (
  sampleRate: number,
): Promise<TimePitchProcessor> => {
  const wasmModule = await createTimeStretchWasmModule();
  wasmModule._main();

  const tonalityLimit = tonalityLimitHz / sampleRate;

  let state: TimePitchProcessorState | undefined = undefined;
  let inputFrameFraction = 0;
  let transposeSemitones = 0;
  let tempoRatio = 1;

  return {
    process: (outputs, fillInput) => {
      const outputFrameCount = outputs[0].length;

      if (transposeSemitones === 0 && tempoRatio === 1) {
        fillInput(outputs, 0, outputFrameCount);
        return outputFrameCount;
      }

      const frameCounts = getFrameCounts(
        outputFrameCount,
        tempoRatio,
        inputFrameFraction,
      );
      inputFrameFraction = frameCounts.inputFrameFraction;

      if (
        !state ||
        state.channelCount !== outputs.length ||
        state.bufferLength < outputFrameCount
      ) {
        state = createState(wasmModule, outputs, sampleRate, outputFrameCount);
      }

      wasmModule._setTransposeSemitones(transposeSemitones, tonalityLimit);
      wasmModule._setFormantSemitones(0, false);
      wasmModule._setFormantBase(0);

      for (const inputBuffer of state.inputBuffers) {
        inputBuffer.fill(0);
      }

      const inputEndFrameOffset =
        Math.round(state.outputLatency * tempoRatio) + state.inputLatency;
      fillInput(
        state.inputBuffers,
        inputEndFrameOffset - state.bufferLength,
        state.bufferLength,
      );
      wasmModule._seek(state.bufferLength, tempoRatio);
      wasmModule._process(0, outputFrameCount);

      for (
        let channelIndex = 0;
        channelIndex < outputs.length;
        channelIndex += 1
      ) {
        outputs[channelIndex].set(
          state.outputBuffers[channelIndex].subarray(0, outputFrameCount),
        );
      }

      return frameCounts.inputFrameCount;
    },
    reset: () => {
      state = undefined;
      inputFrameFraction = 0;
    },
    setTransposeSemitones: (nextTransposeSemitones) => {
      transposeSemitones = nextTransposeSemitones;
    },
    setTempoRatio: (nextTempoRatio) => {
      tempoRatio = nextTempoRatio;
    },
  };
};
