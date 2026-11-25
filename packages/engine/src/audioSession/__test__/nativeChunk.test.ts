import { describe, expect, it } from 'vitest';
import { decodeNativeChunk } from '../nativeChunk.js';

const encode = (header: number[], samples: number[]) => {
  const buffer = new ArrayBuffer(
    header.length * Float64Array.BYTES_PER_ELEMENT +
      samples.length * Float32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(buffer);
  header.forEach((value, index) => {
    view.setFloat64(index * Float64Array.BYTES_PER_ELEMENT, value, true);
  });
  samples.forEach((value, index) => {
    view.setFloat32(
      header.length * Float64Array.BYTES_PER_ELEMENT +
        index * Float32Array.BYTES_PER_ELEMENT,
      value,
      true,
    );
  });
  return buffer;
};

describe('decodeNativeChunk', () => {
  it('reads the little-endian header and samples the native capture writes', () => {
    const decoded = decodeNativeChunk(
      encode([3, 1250.5, 48000, 960], [0.25, -0.5, 1]),
      1000.25,
    );
    expect(decoded.session).toBe(3);
    expect(decoded.chunk.startMs).toBe(250.25);
    expect(decoded.chunk.sampleRate).toBe(48000);
    expect(decoded.chunk.frame).toBe(960);
    expect(Array.from(decoded.chunk.samples)).toEqual([0.25, -0.5, 1]);
  });

  it('reads a chunk without samples', () => {
    const decoded = decodeNativeChunk(encode([1, 10, 44100, 0], []), 0);
    expect(decoded.chunk.samples).toHaveLength(0);
    expect(decoded.chunk.sampleRate).toBe(44100);
  });
});
