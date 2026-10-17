const capacity = 1 << 17;
const mask = capacity - 1;

export type SampleRing = {
  write: (frame: number, samples: Float32Array) => void;
  sampleAt: (at: number) => number;
  clear: () => void;
};

export const createSampleRing = (): SampleRing => {
  const ring = new Float32Array(capacity);
  let end: number | undefined = undefined;

  const read = (frame: number) =>
    end !== undefined && frame < end && frame >= end - capacity
      ? ring[frame & mask]
      : 0;

  return {
    write: (frame, samples) => {
      const previousEnd = end ?? frame;
      const nextEnd = Math.max(previousEnd, frame + samples.length);
      const oldest = nextEnd - capacity;
      for (let gap = Math.max(previousEnd, oldest); gap < frame; gap += 1) {
        ring[gap & mask] = 0;
      }
      for (let index = 0; index < samples.length; index += 1) {
        const target = frame + index;
        if (target >= oldest) {
          ring[target & mask] = samples[index];
        }
      }
      end = nextEnd;
    },
    sampleAt: (at) => {
      const index = Math.floor(at);
      const offset = at - index;
      const before = read(index - 1);
      const current = read(index);
      const next = read(index + 1);
      const after = read(index + 2);
      return (
        current +
        0.5 *
          offset *
          (next -
            before +
            offset *
              (2 * before -
                5 * current +
                4 * next -
                after +
                offset * (3 * (current - next) + after - before)))
      );
    },
    clear: () => {
      ring.fill(0);
      end = undefined;
    },
  };
};
