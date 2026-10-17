export type RenderHistoryEntry = {
  contextFrame: number;
  frameIndex: number;
  rate: number;
};

export type RenderHistory = {
  push: (entry: RenderHistoryEntry) => void;
  find: (contextFrame: number) => RenderHistoryEntry | undefined;
  first: () => RenderHistoryEntry | undefined;
  clear: () => void;
};

export const createRenderHistory = (capacity: number): RenderHistory => {
  const entries: RenderHistoryEntry[] = [];
  let start = 0;
  let size = 0;

  const at = (index: number) => entries[(start + index) % capacity];

  return {
    push: (entry) => {
      if (size < capacity) {
        entries[(start + size) % capacity] = entry;
        size += 1;
        return;
      }
      entries[start] = entry;
      start = (start + 1) % capacity;
    },
    find: (contextFrame) => {
      if (size === 0 || contextFrame < at(0).contextFrame) {
        return undefined;
      }
      let low = 0;
      let high = size - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (at(middle).contextFrame <= contextFrame) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      return at(low);
    },
    first: () => (size > 0 ? at(0) : undefined),
    clear: () => {
      start = 0;
      size = 0;
    },
  };
};
