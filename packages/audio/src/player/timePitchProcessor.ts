import {
  type InitOutput,
  initSync,
  openStretcher,
  processStretcher,
  resetStretcher,
  seekStretcher,
  setStretcherBuffers,
  setStretcherFormants,
  setStretcherSemitones,
  stretcherInputLatency,
  stretcherOutputLatency,
  stretcherSeekLength,
  type SyncInitInput,
} from '@musetric/dsp/stretch';

export const loadTimePitch = (module: SyncInitInput): InitOutput =>
  initSync({ module });

const continuityFrameCount = 4;

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

type TimePitchProcessorState = {
  handle: number;
  semitones: number;
  formants: boolean;
  pointer: number;
  bufferLength: number;
  channelCount: number;
  inputLatency: number;
  outputLatency: number;
  memoryBuffer: ArrayBuffer;
  inputBuffers: Float32Array[];
  outputBuffers: Float32Array[];
};

const viewBuffers = (
  stretch: InitOutput,
  state: TimePitchProcessorState,
): void => {
  const { buffer } = stretch.memory;
  if (state.memoryBuffer === buffer) {
    return;
  }
  const lengthBytes = state.bufferLength * Float32Array.BYTES_PER_ELEMENT;
  const view = (index: number) =>
    new Float32Array(
      buffer,
      state.pointer + lengthBytes * index,
      state.bufferLength,
    );
  state.memoryBuffer = buffer;
  state.inputBuffers = Array.from({ length: state.channelCount }, (_, index) =>
    view(index),
  );
  state.outputBuffers = Array.from({ length: state.channelCount }, (_, index) =>
    view(index + state.channelCount),
  );
};

const createState = (
  stretch: InitOutput,
  channelCount: number,
  sampleRate: number,
  outputFrameCount: number,
): TimePitchProcessorState => {
  const handle = openStretcher(channelCount, sampleRate);
  const bufferLength = Math.max(outputFrameCount, stretcherSeekLength(handle));
  const state: TimePitchProcessorState = {
    handle,
    semitones: 0,
    formants: false,
    pointer: setStretcherBuffers(handle, bufferLength),
    bufferLength,
    channelCount,
    inputLatency: stretcherInputLatency(handle),
    outputLatency: stretcherOutputLatency(handle),
    memoryBuffer: new ArrayBuffer(0),
    inputBuffers: [],
    outputBuffers: [],
  };
  viewBuffers(stretch, state);
  return state;
};

type TimePitchProcessorInputFiller = (
  inputs: Float32Array[],
  inputFrameOffset: number,
  inputFrameCount: number,
) => void;

export type TimePitchProcessor = {
  process: (
    outputs: Float32Array[],
    inputFrame: number,
    fillInput: TimePitchProcessorInputFiller,
  ) => number;
  reset: () => void;
  refill: () => void;
  setTransposeSemitones: (transposeSemitones: number) => void;
  setTempoRatio: (tempoRatio: number) => void;
  setFormantCompensation: (formantCompensation: boolean) => void;
};

type Stream = {
  tempoRatio: number;
  headFrame: number;
  nextInputFrame: number;
};

export const createTimePitchProcessor = (
  stretch: InitOutput,
  sampleRate: number,
): TimePitchProcessor => {
  let state: TimePitchProcessorState | undefined = undefined;
  let stream: Stream | undefined = undefined;
  let inputFrameFraction = 0;
  let transposeSemitones = 0;
  let tempoRatio = 1;
  let formantCompensation = false;

  const continues = (current: Stream, inputFrame: number) =>
    current.tempoRatio === tempoRatio &&
    Math.abs(inputFrame - current.nextInputFrame) <= continuityFrameCount;

  const prime = (
    current: TimePitchProcessorState,
    inputFrame: number,
    fillInput: TimePitchProcessorInputFiller,
  ): Stream => {
    const headOffset =
      Math.round(current.outputLatency * tempoRatio) + current.inputLatency;
    for (const inputBuffer of current.inputBuffers) {
      inputBuffer.fill(0);
    }
    fillInput(
      current.inputBuffers,
      headOffset - current.bufferLength,
      current.bufferLength,
    );
    seekStretcher(current.handle, current.bufferLength, tempoRatio);
    return {
      tempoRatio,
      headFrame: inputFrame + headOffset,
      nextInputFrame: inputFrame,
    };
  };

  return {
    process: (outputs, inputFrame, fillInput) => {
      const outputFrameCount = outputs[0].length;

      if (transposeSemitones === 0 && tempoRatio === 1) {
        stream = undefined;
        fillInput(outputs, 0, outputFrameCount);
        return outputFrameCount;
      }

      const frameCounts = getFrameCounts(
        outputFrameCount,
        tempoRatio,
        inputFrameFraction,
      );
      inputFrameFraction = frameCounts.inputFrameFraction;
      const { inputFrameCount } = frameCounts;

      if (
        !state ||
        state.channelCount !== outputs.length ||
        state.bufferLength < Math.max(outputFrameCount, inputFrameCount)
      ) {
        state = createState(
          stretch,
          outputs.length,
          sampleRate,
          Math.max(outputFrameCount, inputFrameCount),
        );
        stream = undefined;
      }
      viewBuffers(stretch, state);

      if (state.semitones !== transposeSemitones) {
        setStretcherSemitones(state.handle, transposeSemitones);
        state.semitones = transposeSemitones;
      }
      if (state.formants !== formantCompensation) {
        setStretcherFormants(state.handle, formantCompensation);
        state.formants = formantCompensation;
      }

      if (!stream || !continues(stream, inputFrame)) {
        stream = prime(state, inputFrame, fillInput);
      }

      const inputs = state.inputBuffers;
      for (const inputBuffer of inputs) {
        inputBuffer.fill(0, 0, inputFrameCount);
      }
      fillInput(inputs, stream.headFrame - inputFrame, inputFrameCount);
      processStretcher(state.handle, inputFrameCount, outputFrameCount);
      stream.headFrame += inputFrameCount;
      stream.nextInputFrame = inputFrame + inputFrameCount;

      for (
        let channelIndex = 0;
        channelIndex < outputs.length;
        channelIndex += 1
      ) {
        outputs[channelIndex].set(
          state.outputBuffers[channelIndex].subarray(0, outputFrameCount),
        );
      }

      return inputFrameCount;
    },
    reset: () => {
      if (state) {
        resetStretcher(state.handle);
      }
      stream = undefined;
      inputFrameFraction = 0;
    },
    refill: () => {
      stream = undefined;
    },
    setTransposeSemitones: (nextTransposeSemitones) => {
      transposeSemitones = nextTransposeSemitones;
    },
    setTempoRatio: (nextTempoRatio) => {
      tempoRatio = nextTempoRatio;
    },
    setFormantCompensation: (nextFormantCompensation) => {
      formantCompensation = nextFormantCompensation;
    },
  };
};
