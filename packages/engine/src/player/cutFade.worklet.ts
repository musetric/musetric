import { fadeFrameCount } from './playerRange.worklet.js';

const createCutFade = () => {
  let level = 0;
  let rising = false;
  return {
    silent: () => level === 0 && !rising,
    rise: (next: boolean) => {
      rising = next;
    },
    mute: () => {
      level = 0;
      rising = false;
    },
    apply: (outputs: Float32Array[]) => {
      if (rising && level === fadeFrameCount) {
        return;
      }
      const frameCount = outputs.at(0)?.length ?? 0;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const gain = level / fadeFrameCount;
        for (let channel = 0; channel < outputs.length; channel += 1) {
          outputs[channel][frame] *= gain;
        }
        level = rising
          ? Math.min(fadeFrameCount, level + 1)
          : Math.max(0, level - 1);
      }
    },
  };
};

export type CutFade = {
  silent: () => boolean;
  mute: () => void;
  apply: (outputs: Float32Array[]) => void;
};

export type Cuts = {
  fade: CutFade;
  cut: (apply: () => void) => void;
  after: (apply: () => void) => void;
  settle: () => void;
  follow: (ready: boolean) => void;
  flush: () => void;
};

export const createCuts = (sounding: () => boolean): Cuts => {
  const fade = createCutFade();
  const queue: (() => void)[] = [];
  const flush = () => {
    fade.mute();
    for (let index = 0; index < queue.length; index += 1) {
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- the queue holds the commands of messages, each run once
      queue[index]();
    }
    queue.length = 0;
  };
  return {
    fade,
    cut: (apply) => {
      if (queue.length === 0 && (!sounding() || fade.silent())) {
        fade.mute();
        apply();
        return;
      }
      queue.push(apply);
      fade.rise(false);
    },
    after: (apply) => {
      if (queue.length === 0) {
        apply();
        return;
      }
      queue.push(apply);
    },
    settle: () => {
      if (queue.length > 0 && (fade.silent() || !sounding())) {
        flush();
      }
    },
    follow: (ready) => {
      fade.rise(ready && queue.length === 0);
    },
    flush,
  };
};
