import { type PitchSettings } from './settings.es.js';

export const floorMod = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

export type ScheduleState = {
  observed: Int32Array;
  observedFinal: Uint8Array;
  decoded: Int32Array;
  decodedFinal: Uint8Array;
};

export const createScheduleState = (ringFrames: number): ScheduleState => ({
  observed: new Int32Array(ringFrames).fill(-1),
  observedFinal: new Uint8Array(ringFrames),
  decoded: new Int32Array(ringFrames).fill(-1),
  decodedFinal: new Uint8Array(ringFrames),
});

export const resetState = (state: ScheduleState): void => {
  state.observed.fill(-1);
  state.observedFinal.fill(0);
  state.decoded.fill(-1);
  state.decodedFinal.fill(0);
};

export type PitchSampleRange = {
  frameIndex: number;
  frameCount: number;
};

export const invalidate = (
  state: ScheduleState,
  settings: PitchSettings,
  range: PitchSampleRange,
): void => {
  const { hop, support, ringFrames, historyFrames, lookaheadFrames } = settings;
  const first = Math.ceil((range.frameIndex - support) / hop);
  const last = Math.floor(
    (range.frameIndex + range.frameCount - 1 + support) / hop,
  );
  for (let frame = first; frame <= last; frame += 1) {
    const slot = floorMod(frame, ringFrames);
    if (state.observed[slot] === frame) {
      state.observed[slot] = -1;
    }
  }
  for (
    let frame = first - lookaheadFrames;
    frame <= last + historyFrames;
    frame += 1
  ) {
    const slot = floorMod(frame, ringFrames);
    if (state.decoded[slot] === frame) {
      state.decodedFinal[slot] = 0;
    }
  }
};
