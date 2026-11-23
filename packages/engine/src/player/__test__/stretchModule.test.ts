import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('stretch module', () => {
  it('needs nothing an audio worklet lacks', () => {
    const glue = readFileSync(
      createRequire(import.meta.url).resolve('@musetric/dsp/stretch'),
      'utf8',
    );
    expect(glue).not.toMatch(/TextDecoder|TextEncoder/);
  });
});
