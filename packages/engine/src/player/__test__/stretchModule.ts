import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type InitOutput, initSync } from '@musetric/dsp/stretch';

export const loadStretch = (): InitOutput =>
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@musetric/dsp/stretch.wasm'),
    ),
  });
