import { type Logger } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

export type ReadPcmOptions = {
  fromPath: string;
  sampleRate: number;
  logger: Logger;
  onSample: (left: number, right: number, sampleIndex: number) => void;
};

export const readPcm = async (options: ReadPcmOptions): Promise<void> => {
  const { fromPath, sampleRate, logger, onSample } = options;
  const floatsPerSample = 2;
  const bytesPerSample = Float32Array.BYTES_PER_ELEMENT * floatsPerSample;
  let carry: Buffer = Buffer.alloc(0);
  let sampleIndex = 0;

  await spawnScript({
    command: 'ffmpeg',
    flatArgs: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      fromPath,
      '-map',
      '0:a:0',
      '-sn',
      '-dn',
      '-vn',
      '-ac',
      '2',
      '-ar',
      sampleRate.toString(),
      '-f',
      'f32le',
      '-',
    ],
    stdout: {
      mode: 'binary',
      onChunk: (chunk) => {
        const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;

        const tailLength = data.byteLength % bytesPerSample;
        const alignedLength = data.byteLength - tailLength;
        const buffer = data.subarray(0, alignedLength);
        const tail = data.subarray(alignedLength);
        const array = new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
        for (let i = 0; i < array.length; i += floatsPerSample) {
          onSample(array[i], array[i + 1], sampleIndex);
          sampleIndex += 1;
        }
        carry = tail;
      },
    },
    stderr: { mode: 'logText' },
    logger,
    processName: 'generateWavePeaks.readPcm',
  });
};
