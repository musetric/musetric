import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadTimePitch } from '@musetric/audio/player';
import { type InitOutput } from '@musetric/dsp/stretch';

export const loadStretch = (): InitOutput =>
  loadTimePitch(
    readFileSync(
      createRequire(import.meta.url).resolve('@musetric/dsp/stretch.wasm'),
    ),
  );
