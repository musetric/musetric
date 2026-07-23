import { wavePeakCount } from '@musetric/toolkit';
import {
  wavBytesPerSample,
  wavHeaderByteLength,
} from '../../services/recordingWav.js';
import { type RecordingSession } from './session.js';

export type PeakPatch = {
  startPeakIndex: number;
  peaks: Float32Array;
};

export const createPeakPatch = async (
  session: RecordingSession,
  frameIndex: number,
  frameLength: number,
): Promise<PeakPatch | undefined> => {
  if (!frameLength || !session.frameCount) {
    return undefined;
  }

  const framesPerPeak = Math.max(1, session.frameCount / wavePeakCount);
  const startPeakIndex = Math.max(0, Math.floor(frameIndex / framesPerPeak));
  const endPeakIndex = Math.min(
    wavePeakCount - 1,
    Math.floor((frameIndex + frameLength - 1) / framesPerPeak),
  );
  if (endPeakIndex < startPeakIndex) {
    return undefined;
  }

  const peaks = new Float32Array((endPeakIndex - startPeakIndex + 1) * 2);
  for (
    let peakIndex = startPeakIndex;
    peakIndex <= endPeakIndex;
    peakIndex += 1
  ) {
    const peakStartFrame = Math.floor(peakIndex * framesPerPeak);
    const peakEndFrame = Math.min(
      session.frameCount,
      Math.floor((peakIndex + 1) * framesPerPeak),
    );
    const frameCount = Math.max(0, peakEndFrame - peakStartFrame);
    const buffer = Buffer.alloc(frameCount * wavBytesPerSample);
    await session.file.read(
      buffer,
      0,
      buffer.byteLength,
      wavHeaderByteLength + peakStartFrame * wavBytesPerSample,
    );

    let min = 0;
    let max = 0;
    for (let offset = 0; offset < buffer.byteLength; offset += 2) {
      const value = buffer.readInt16LE(offset) / 32768;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    const patchIndex = (peakIndex - startPeakIndex) * 2;
    peaks[patchIndex] = min;
    peaks[patchIndex + 1] = max;
  }

  await session.waveFile.write(
    Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength),
    0,
    peaks.byteLength,
    startPeakIndex * 2 * Float32Array.BYTES_PER_ELEMENT,
  );

  return { startPeakIndex, peaks };
};
