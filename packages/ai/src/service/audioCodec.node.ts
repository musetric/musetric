import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { type Logger } from '@musetric/utils';

const execFileAsync = promisify(execFile);

type RunFfmpegOptions = {
  args: string[];
  input?: Buffer;
  captureStdout?: boolean;
  logger: Logger;
  processName: string;
};

const runFfmpeg = async (options: RunFfmpegOptions): Promise<Buffer> => {
  const { args, input, captureStdout, logger, processName } = options;
  const stdoutChunks: Buffer[] = [];
  let lastStderr = '';

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk: Buffer) => {
      if (captureStdout) {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      lastStderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        logger.error({ processName, code }, lastStderr.trim());
        reject(
          new Error(
            lastStderr.trim() ||
              `ffmpeg failed with exit code ${code ?? 'unknown'}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
};

type DecodeOptions = {
  sourcePath: string;
  sampleRate: number;
  logger: Logger;
};

export const decodeInterleavedPcm = async (
  options: DecodeOptions,
): Promise<Buffer> => {
  const { sourcePath, sampleRate, logger } = options;
  const output = await runFfmpeg({
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
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
      '-c:a',
      'pcm_f32le',
      'pipe:1',
    ],
    captureStdout: true,
    logger,
    processName: 'ai.decodeInterleavedPcm',
  });
  if (output.byteLength === 0) {
    throw new Error('ffmpeg produced no audio data');
  }
  return output;
};

const probeChannelCount = async (sourcePath: string): Promise<number> => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=channels',
    '-of',
    'csv=p=0',
    sourcePath,
  ]);
  return Number(stdout.trim());
};

const meanDownmixArgs = async (sourcePath: string): Promise<string[]> => {
  const channels = await probeChannelCount(sourcePath);
  if (channels <= 1) {
    return ['-ac', '1'];
  }
  const weight = 1 / channels;
  const terms = Array.from(
    { length: channels },
    (_ignored, index) => `${weight}*c${index}`,
  ).join('+');
  return ['-af', `pan=mono|c0=${terms}`];
};

export type MonoDownmix = 'rematrix' | 'mean';

type DecodeMonoOptions = DecodeOptions & {
  downmix?: MonoDownmix;
};

export const decodeMonoPcm = async (
  options: DecodeMonoOptions,
): Promise<Buffer> => {
  const { sourcePath, sampleRate, logger, downmix } = options;
  const downmixArgs =
    downmix === 'mean' ? await meanDownmixArgs(sourcePath) : ['-ac', '1'];
  const output = await runFfmpeg({
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-map',
      '0:a:0',
      '-sn',
      '-dn',
      '-vn',
      ...downmixArgs,
      '-ar',
      sampleRate.toString(),
      '-f',
      'f32le',
      '-c:a',
      'pcm_f32le',
      'pipe:1',
    ],
    captureStdout: true,
    logger,
    processName: 'ai.decodeMonoPcm',
  });
  if (output.byteLength === 0) {
    throw new Error('ffmpeg produced no audio data');
  }
  return output;
};

type EncodeOptions = {
  rawPath: string;
  inputSampleRate: number;
  outputSampleRate: number;
  outputPath: string;
  logger: Logger;
};

export const encodeFlacFromRawFile = async (
  options: EncodeOptions,
): Promise<void> => {
  const { rawPath, inputSampleRate, outputSampleRate, outputPath, logger } =
    options;
  await runFfmpeg({
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'f32le',
      '-ar',
      inputSampleRate.toString(),
      '-ac',
      '2',
      '-i',
      rawPath,
      '-ar',
      outputSampleRate.toString(),
      '-c:a',
      'flac',
      '-sample_fmt',
      's32',
      '-f',
      'flac',
      '-y',
      outputPath,
    ],
    logger,
    processName: 'ai.encodeFlacFromRawFile',
  });
};
