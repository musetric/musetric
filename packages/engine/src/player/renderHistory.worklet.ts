export type RenderHistory = {
  contextFrames: Float64Array;
  frameIndices: Float64Array;
  rates: Float64Array;
  push: (contextFrame: number, frameIndex: number, rate: number) => void;
  find: (contextFrame: number) => number;
  first: () => number;
  clear: () => void;
};

export const createRenderHistory = (capacity: number): RenderHistory => {
  const contextFrames = new Float64Array(capacity);
  const frameIndices = new Float64Array(capacity);
  const rates = new Float64Array(capacity);
  let start = 0;
  let size = 0;

  const slot = (index: number) => (start + index) % capacity;

  return {
    contextFrames,
    frameIndices,
    rates,
    push: (contextFrame, frameIndex, rate) => {
      const next = slot(size);
      contextFrames[next] = contextFrame;
      frameIndices[next] = frameIndex;
      rates[next] = rate;
      if (size < capacity) {
        size += 1;
        return;
      }
      start = (start + 1) % capacity;
    },
    find: (contextFrame) => {
      if (size === 0 || contextFrame < contextFrames[slot(0)]) {
        return -1;
      }
      let low = 0;
      let high = size - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (contextFrames[slot(middle)] <= contextFrame) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      return slot(low);
    },
    first: () => (size > 0 ? slot(0) : -1),
    clear: () => {
      start = 0;
      size = 0;
    },
  };
};
