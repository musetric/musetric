import { type FoldTail } from './separationFold.js';
import { type StemValues } from './separationStems.js';

const stateVersion = 1;
const headerWords = 8;
const headerValues = 5;
const headerBytes = headerWords * 4 + headerValues * 8;

export type SeparationLayout = {
  frames: number;
  chunkSamples: number;
  step: number;
  unitCount: number;
  outputs: number;
};

export type SeparationState = {
  tail: FoldTail;
  mixtureScale: number;
  peaks: StemValues;
};

export const writeSeparationState = (
  layout: SeparationLayout,
  state: SeparationState,
): Uint8Array<ArrayBuffer> => {
  const { tail } = state;
  const bytes = new Uint8Array(
    headerBytes + (tail.target.length + tail.counter.length) * 4,
  );
  const view = new DataView(bytes.buffer);
  const words = [
    stateVersion,
    layout.frames,
    layout.chunkSamples,
    layout.step,
    layout.unitCount,
    tail.nextUnit,
    tail.settled,
    tail.reached,
  ];
  for (const [index, word] of words.entries()) {
    view.setUint32(index * 4, word, true);
  }
  const values = [
    state.mixtureScale,
    state.peaks.vocals,
    state.peaks.instrumental,
    state.peaks.lead,
    state.peaks.backing,
  ];
  for (const [index, value] of values.entries()) {
    view.setFloat64(headerWords * 4 + index * 8, value, true);
  }
  bytes.set(
    new Uint8Array(
      tail.target.buffer,
      tail.target.byteOffset,
      tail.target.byteLength,
    ),
    headerBytes,
  );
  bytes.set(
    new Uint8Array(
      tail.counter.buffer,
      tail.counter.byteOffset,
      tail.counter.byteLength,
    ),
    headerBytes + tail.target.byteLength,
  );
  return bytes;
};

export const readSeparationState = (
  layout: SeparationLayout,
  bytes: Uint8Array,
): SeparationState | undefined => {
  if (bytes.length < headerBytes) {
    return undefined;
  }
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const word = (index: number): number => view.getUint32(index * 4, true);
  const value = (index: number): number =>
    view.getFloat64(headerWords * 4 + index * 8, true);
  const nextUnit = word(5);
  const settled = word(6);
  const reached = word(7);
  const kept = reached - settled;
  if (
    word(0) !== stateVersion ||
    word(1) !== layout.frames ||
    word(2) !== layout.chunkSamples ||
    word(3) !== layout.step ||
    word(4) !== layout.unitCount ||
    kept < 0 ||
    copy.length !== headerBytes + kept * (layout.outputs + 1) * 4
  ) {
    return undefined;
  }
  const targetLength = kept * layout.outputs;
  return {
    tail: {
      nextUnit,
      settled,
      reached,
      target: new Float32Array(copy.buffer, headerBytes, targetLength),
      counter: new Float32Array(
        copy.buffer,
        headerBytes + targetLength * 4,
        kept,
      ),
    },
    mixtureScale: value(0),
    peaks: {
      vocals: value(1),
      instrumental: value(2),
      lead: value(3),
      backing: value(4),
    },
  };
};
