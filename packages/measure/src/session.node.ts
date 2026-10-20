import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type MeasureDevice } from './device.node.js';
import { openMeasurePage } from './page.node.js';
import { formatLatency } from './report.es.js';
import { calibrationSchema, type PageLatency } from './runs.es.js';

export type MeasureOutput = {
  path: (name: string) => string;
  write: (name: string, text: string) => void;
  read: (name: string) => string;
};

export const createOutput = (outDir: string): MeasureOutput => {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  return {
    path: (name) => resolve(outDir, name),
    write: (name, text) => {
      writeFileSync(resolve(outDir, name), text);
    },
    read: (name) => readFileSync(resolve(outDir, name), 'utf8'),
  };
};

export type MeasureCommand = 'timing' | 'delay' | 'sound';

export type MeasureRequest = {
  command: MeasureCommand;
  device: MeasureDevice;
  outDir: string;
  reanalyze: boolean;
  calibrate: boolean;
  takeOnly: boolean;
  seconds: number;
  tempos: number[];
  startSeconds: number;
  takeSeconds: number;
  volumeDb: number;
  signal?: string;
};

export const openCalibratedPage = async (request: MeasureRequest) => {
  const page = await openMeasurePage(request.device);
  try {
    if (request.calibrate) {
      console.log('Calibrating the setup with the app check');
      const calibration = calibrationSchema.parse(
        JSON.parse(await page.callText('calibrate', {})),
      );
      if (!calibration.calibrated) {
        throw new Error(
          `The calibration failed: ${calibration.error ?? 'unknown'}`,
        );
      }
      console.log(formatLatency(calibration.latency));
      return page;
    }
    const latency = calibrationSchema.shape.latency.parse(
      JSON.parse(await page.callText('latency', {})),
    );
    if (latency.latencySource !== 'calibrated') {
      throw new Error(
        'This setup is not calibrated: run the command without --keep-calibration',
      );
    }
    console.log(formatLatency(latency));
    return page;
  } catch (error) {
    page.close();
    throw error;
  }
};

export const formatSetup = (latency: PageLatency) =>
  `Setup: ${formatLatency(latency)}.`;
