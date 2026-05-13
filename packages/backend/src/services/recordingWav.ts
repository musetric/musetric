import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defaultSampleRate } from '@musetric/resource-utils';

export const wavContentType = 'audio/wav';

export const wavHeaderByteLength = 44;
export const wavBytesPerSample = 2;

const createWavHeader = (frameCount: number, sampleRate: number): Buffer => {
  const dataByteLength = frameCount * wavBytesPerSample;
  const buffer = Buffer.alloc(wavHeaderByteLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * wavBytesPerSample, 28);
  buffer.writeUInt16LE(wavBytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);
  return buffer;
};

export const createEmptyWavBuffer = () => createWavHeader(0, defaultSampleRate);

export type CreateReservedWavOptions = {
  toPath: string;
  frameCount: number;
  sampleRate: number;
};

export const createReservedWav = async (
  options: CreateReservedWavOptions,
): Promise<void> => {
  const { toPath, frameCount, sampleRate } = options;
  await mkdir(dirname(toPath), { recursive: true });
  const file = await open(toPath, 'w');
  try {
    await file.write(createWavHeader(frameCount, sampleRate), 0);
    await file.truncate(wavHeaderByteLength + frameCount * wavBytesPerSample);
  } finally {
    await file.close();
  }
};
