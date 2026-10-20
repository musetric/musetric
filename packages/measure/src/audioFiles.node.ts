import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export type WavFormat = 'pcm16' | 'float32';

export const writeWav = (
  path: string,
  samples: Float32Array,
  sampleRate: number,
  format: WavFormat,
) => {
  const bytesPerSample = format === 'pcm16' ? 2 : 4;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(format === 'pcm16' ? 1 : 3, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((value, index) => {
    const offset = 44 + index * bytesPerSample;
    if (format === 'pcm16') {
      const clamped = Math.max(-1, Math.min(1, value));
      buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    } else {
      buffer.writeFloatLE(value, offset);
    }
  });
  writeFileSync(path, buffer);
};

const findChunk = (buffer: Buffer, name: string) => {
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString('ascii', offset, offset + 4) === name) {
      return { start: offset + 8, size };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`The WAV file has no ${name} chunk`);
};

export type WavSignal = {
  sampleRate: number;
  samples: Float32Array;
};

export const readWav = (path: string): WavSignal => {
  const buffer = readFileSync(path);
  const format = findChunk(buffer, 'fmt ');
  const data = findChunk(buffer, 'data');
  const code = buffer.readUInt16LE(format.start);
  const channels = buffer.readUInt16LE(format.start + 2);
  const sampleRate = buffer.readUInt32LE(format.start + 4);
  const bits = buffer.readUInt16LE(format.start + 14);
  const bytesPerSample = bits / 8;
  const frameCount = Math.floor(data.size / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = data.start + frame * bytesPerSample * channels;
    samples[frame] =
      code === 3
        ? buffer.readFloatLE(offset)
        : buffer.readInt16LE(offset) / 32768;
  }
  return { sampleRate, samples };
};

export type PlaybackOptions = {
  loop: boolean;
  volumeDb: number;
};

export type Playback = {
  finished: Promise<void>;
  stop: () => void;
};

export const playFile = (path: string, options: PlaybackOptions): Playback => {
  const child = spawn(
    'ffplay',
    [
      '-nodisp',
      '-loglevel',
      'quiet',
      ...(options.loop ? ['-loop', '0'] : ['-autoexit']),
      '-af',
      `volume=${options.volumeDb}dB`,
      path,
    ],
    { stdio: 'ignore' },
  );
  const finished = new Promise<void>((resolve, reject) => {
    child.on('exit', () => {
      resolve();
    });
    child.on('error', reject);
  });
  return {
    finished,
    stop: () => {
      child.kill();
    },
  };
};
