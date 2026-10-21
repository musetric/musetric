import { type DelayOptions, measureDelayTake } from './delay.js';
import { type PageHooks } from './hooks.js';
import { calibrate, readMeasureLatency } from './latency.js';
import {
  type BrowserCaptureOptions,
  captureBrowserMicrophone,
  recordSoundTake,
  type SoundTakeOptions,
} from './sound.js';
import { measureTimingTake, type TimingOptions } from './timing.js';

declare const musetricMeasureHooks: PageHooks | undefined;

const installMeasure = (hooks: PageHooks) => {
  const { engine } = hooks;
  let kept = '';
  // eslint-disable-next-line musetric/no-global-state -- the driver calls the injected procedures through one entry point
  Object.assign(globalThis, {
    musetricMeasure: {
      latency: () => readMeasureLatency(engine),
      calibrate: async () => calibrate(engine),
      timing: async (options: TimingOptions) =>
        measureTimingTake(hooks, options),
      delay: async (options: DelayOptions) => measureDelayTake(hooks, options),
      browserCapture: async (options: BrowserCaptureOptions) =>
        captureBrowserMicrophone(engine, options),
      take: async (options: SoundTakeOptions) =>
        recordSoundTake(engine, options),
      keep: async (value: Promise<unknown>) => {
        kept = JSON.stringify(await value);
        return kept.length;
      },
      read: (start: number, length: number) =>
        kept.slice(start, start + length),
    },
  });
};

if (typeof musetricMeasureHooks === 'undefined') {
  throw new Error('The page has no measure hooks');
}
installMeasure(musetricMeasureHooks);
