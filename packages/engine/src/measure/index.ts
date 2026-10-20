import { type Engine } from '../engine.js';
import { type CapturedTap } from './capturedTap.js';
import { type DelayOptions, measureDelayTake } from './delay.js';
import { calibrate, readMeasureLatency } from './latency.js';
import {
  type BrowserCaptureOptions,
  captureBrowserMicrophone,
  recordSoundTake,
  type SoundTakeOptions,
} from './sound.js';
import { measureTimingTake, type TimingOptions } from './timing.js';

export const exposeEngineMeasure = (engine: Engine, tap: CapturedTap) => {
  let kept = '';
  // eslint-disable-next-line musetric/no-global-state -- the measure build gives the external driver one entry point
  Object.assign(globalThis, {
    musetricMeasure: {
      latency: () => readMeasureLatency(engine),
      calibrate: async () => calibrate(engine),
      timing: async (options: TimingOptions) =>
        measureTimingTake(engine, tap, options),
      delay: async (options: DelayOptions) =>
        measureDelayTake(engine, tap, options),
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
