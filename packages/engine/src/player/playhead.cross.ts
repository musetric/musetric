const frameIndexSlot = 0;
const revisionSlot = 1;
const slotCount = 2;

export type Playhead = Int32Array<SharedArrayBuffer>;

export const createPlayhead = (): Playhead => {
  const buffer = new SharedArrayBuffer(
    slotCount * Int32Array.BYTES_PER_ELEMENT,
  );
  return new Int32Array(buffer);
};

export const writePlayhead = (
  playhead: Playhead,
  frameIndex: number,
  revision: number,
): void => {
  Atomics.store(playhead, frameIndexSlot, frameIndex);
  Atomics.store(playhead, revisionSlot, revision);
};

export type PlayheadValue = {
  frameIndex: number;
  revision: number;
};

export const readPlayhead = (playhead: Playhead): PlayheadValue => {
  const revision = Atomics.load(playhead, revisionSlot);
  const frameIndex = Atomics.load(playhead, frameIndexSlot);
  return { frameIndex, revision };
};
