import { describe, expect, it } from 'vitest';
import { pitchParamFields } from '../params.js';
import { pitchParamsStruct } from '../paramsStruct.wgsl.js';

describe('pitch params', () => {
  it('writes the fields in the order and types of the WGSL struct', () => {
    const declared = pitchParamsStruct
      .split('\n')
      .slice(1, -1)
      .map((line) => line.trim().replace(': ', ':').replace(',', ''));
    const written = pitchParamFields.map((field) => `${field[0]}:${field[1]}`);
    expect(written).toEqual(declared);
  });
});
