import { type InitOutput } from '@musetric/dsp/capture';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadCapture } from '../sampleRing.worklet.js';

export const loadTestCapture = (): InitOutput =>
  loadCapture(
    readFileSync(
      createRequire(import.meta.url).resolve('@musetric/dsp/capture.wasm'),
    ),
  );
