import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { decodeShader } from '../decode.wgsl.js';
import { observeShader } from '../observe.wgsl.js';
import { periodicityShader } from '../periodicity.wgsl.js';
import { projectShader } from '../project.wgsl.js';
import { sliceShader } from '../slice.wgsl.js';
import { spectrumShader } from '../spectrum.wgsl.js';

const shaders = {
  slice: sliceShader,
  spectrum: spectrumShader,
  periodicity: periodicityShader,
  observe: observeShader,
  decode: decodeShader,
  project: projectShader,
};

describe('pitch shaders', () => {
  it.each(Object.entries(shaders))('compiles %s', async (_, code) => {
    const { device } = await createGpuContext();
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const errors = info.messages
      .filter((message) => message.type === 'error')
      .map(
        (message) => `${message.lineNum}:${message.linePos} ${message.message}`,
      );
    expect(errors).toEqual([]);
  });
});
