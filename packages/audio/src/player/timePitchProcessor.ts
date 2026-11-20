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
  type SyncInitInput,
} from '@musetric/dsp/stretch';

export const loadTimePitch = (module: SyncInitInput): InitOutput =>
  initSync({ module });

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
): boolean => {
  const { buffer } = stretch.memory;
  if (state.memoryBuffer === buffer) {
    return false;
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
  return true;
};

const createState = (
  stretch: InitOutput,
  channelCount: number,
  sampleRate: number,
  outputFrameCount: number,
): TimePitchProcessorState => {
  const handle = openStretcher(channelCount, sampleRate);
  const inputLatency = stretcherInputLatency(handle);
  const outputLatency = stretcherOutputLatency(handle);
  const bufferLength = Math.max(outputFrameCount, inputLatency + outputLatency);
  const state: TimePitchProcessorState = {
    handle,
    semitones: 0,
    formants: false,
    pointer: setStretcherBuffers(handle, bufferLength),
    bufferLength,
    channelCount,
    inputLatency,
    outputLatency,
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

export const createTimePitchProcessor = (
  stretch: InitOutput,
  sampleRate: number,
): TimePitchProcessor => {
  let state: TimePitchProcessorState | undefined = undefined;
  let windowStartFrame: number | undefined = undefined;
  const windowTails = new Map<number, Float32Array[]>();
  let inputFrameFraction = 0;
  let transposeSemitones = 0;
  let tempoRatio = 1;
  let formantCompensation = false;

  const getWindowTail = (current: TimePitchProcessorState, frames: number) => {
    let tail = windowTails.get(frames);
    if (!tail) {
      tail = current.inputBuffers.map((buffer) =>
        buffer.subarray(current.bufferLength - frames),
      );
      windowTails.set(frames, tail);
    }
    return tail;
  };

  const fillWindow = (
    current: TimePitchProcessorState,
    inputFrame: number,
    fillInput: TimePitchProcessorInputFiller,
  ) => {
    const inputEndFrameOffset =
      Math.round(current.outputLatency * tempoRatio) + current.inputLatency;
    const startFrame = inputFrame + inputEndFrameOffset - current.bufferLength;
    const shift =
      windowStartFrame === undefined
        ? current.bufferLength
        : startFrame - windowStartFrame;
    windowStartFrame = startFrame;
    if (shift === 0) {
      return;
    }
    if (shift > 0 && shift < current.bufferLength) {
      const tail = getWindowTail(current, shift);
      for (const inputBuffer of current.inputBuffers) {
        inputBuffer.copyWithin(0, shift);
      }
      for (const tailBuffer of tail) {
        tailBuffer.fill(0);
      }
      fillInput(tail, inputEndFrameOffset - shift, shift);
      return;
    }
    for (const inputBuffer of current.inputBuffers) {
      inputBuffer.fill(0);
    }
    fillInput(
      current.inputBuffers,
      inputEndFrameOffset - current.bufferLength,
      current.bufferLength,
    );
  };

  return {
    process: (outputs, inputFrame, fillInput) => {
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
        state = createState(
          stretch,
          outputs.length,
          sampleRate,
          outputFrameCount,
        );
        windowStartFrame = undefined;
        windowTails.clear();
      }
      if (viewBuffers(stretch, state)) {
        windowTails.clear();
      }

      if (state.semitones !== transposeSemitones) {
        setStretcherSemitones(state.handle, transposeSemitones);
        state.semitones = transposeSemitones;
      }
      if (state.formants !== formantCompensation) {
        setStretcherFormants(state.handle, formantCompensation);
        state.formants = formantCompensation;
      }

      fillWindow(state, inputFrame, fillInput);
      seekStretcher(state.handle, state.bufferLength, tempoRatio);
      processStretcher(state.handle, 0, outputFrameCount);

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
      if (state) {
        resetStretcher(state.handle);
      }
      windowStartFrame = undefined;
      inputFrameFraction = 0;
    },
    refill: () => {
      windowStartFrame = undefined;
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
