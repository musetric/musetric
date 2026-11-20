import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type InitOutput } from '@musetric/dsp/capture';
import { loadCapture } from '../sampleRing.cross.js';

export const loadTestCapture = (): InitOutput =>
  loadCapture(
    readFileSync(
      createRequire(import.meta.url).resolve('@musetric/dsp/capture.wasm'),
    ),
  );
