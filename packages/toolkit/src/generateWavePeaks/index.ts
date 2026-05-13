import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Logger } from '@musetric/resource-utils';
import { getAudioFrameCount } from '../getAudioFrameCount.js';
import { readPcm } from './readPcm.js';

export const wavePeakCount = 3840;
export const wavePeakBufferByteLength =
  wavePeakCount * 2 * Float32Array.BYTES_PER_ELEMENT;

export const emptyWavePeaksBuffer = Buffer.alloc(wavePeakBufferByteLength);

export const createEmptyWavePeaksBuffer = (): Buffer =>
  Buffer.from(emptyWavePeaksBuffer);

export type GenerateWavePeaksOptions = {
  fromPath: string;
  toPath: string;
  sampleRate: number;
  logger: Logger;
};

export const generateWavePeaks = async (
  options: GenerateWavePeaksOptions,
): Promise<void> => {
  const { fromPath, toPath, sampleRate, logger } = options;
  await mkdir(dirname(toPath), { recursive: true });

  const wavePeaks = new Float32Array(wavePeakCount * 2);

  const totalSamples = await getAudioFrameCount(fromPath, sampleRate, logger);
  const segmentStep = totalSamples / wavePeakCount;

  let lastSegmentIndex = -1;
  await readPcm({
    fromPath,
    sampleRate,
    logger,
    onSample: (left, right, sampleIndex) => {
      const value = (left + right) * 0.5;
      const segmentIndex = Math.floor(sampleIndex / segmentStep);
      if (segmentIndex >= wavePeakCount) {
        return;
      }
      const baseIndex = segmentIndex * 2;
      if (segmentIndex !== lastSegmentIndex) {
        wavePeaks[baseIndex] = value;
        wavePeaks[baseIndex + 1] = value;
        lastSegmentIndex = segmentIndex;
      }
      if (value < wavePeaks[baseIndex]) {
        wavePeaks[baseIndex] = value;
      }
      if (value > wavePeaks[baseIndex + 1]) {
        wavePeaks[baseIndex + 1] = value;
      }
    },
  });

  await writeFile(
    toPath,
    Buffer.from(wavePeaks.buffer, wavePeaks.byteOffset, wavePeaks.byteLength),
  );
};
