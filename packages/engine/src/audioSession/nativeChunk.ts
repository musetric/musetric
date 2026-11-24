import { type CapturedChunk } from './timedChunkPusher.cross.js';

const headerValueCount = 4;
const headerBytes = headerValueCount * Float64Array.BYTES_PER_ELEMENT;

export type NativeChunk = {
  session: number;
  chunk: CapturedChunk;
};

export const decodeNativeChunk = (
  buffer: ArrayBuffer,
  clockOffsetMs: number,
): NativeChunk => {
  const [session, captureMs, sampleRate, frame] = new Float64Array(
    buffer,
    0,
    headerValueCount,
  );
  return {
    session,
    chunk: {
      startMs: captureMs - clockOffsetMs,
      frame,
      sampleRate,
      samples: new Float32Array(buffer, headerBytes),
    },
  };
};
