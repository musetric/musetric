import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Logger } from '@musetric/resource-utils';
import { type StereoAudio } from '../separation/stereoAudio.js';

type RunFfmpegOptions = {
  args: string[];
  input?: Buffer;
  captureStdout?: boolean;
  logger: Logger;
  processName: string;
};

type ReadAudioFileOptions = {
  sourcePath: string;
  sampleRate: number;
  logger: Logger;
};

type WriteFlacAudioFileOptions = {
  audio: StereoAudio;
  outputSampleRate?: number;
  outputPath: string;
  logger: Logger;
};

const processStderr = (
  data: Buffer,
  carry: string,
  logger: Logger,
  processName: string,
): string => {
  const text = carry + data.toString('utf8');
  const lines = text.split(/\r?\n/);
  const nextCarry = lines.pop() ?? '';
  for (const line of lines) {
    if (line) {
      logger.info({ processName }, line);
    }
  }
  return nextCarry;
};

const runFfmpeg = async (options: RunFfmpegOptions): Promise<Buffer> => {
  const { args, input, captureStdout, logger, processName } = options;
  const stdoutChunks: Buffer[] = [];
  let stderrCarry = '';
  let lastStderr = '';

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (captureStdout) {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      lastStderr += chunk.toString('utf8');
      stderrCarry = processStderr(chunk, stderrCarry, logger, processName);
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (stderrCarry) {
        logger.info({ processName }, stderrCarry);
      }
      if (code !== 0) {
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

const interleavedToPlanar = (
  interleaved: Float32Array<ArrayBuffer>,
  channels: 2,
  sampleRate: number,
): StereoAudio => {
  const samples = Math.floor(interleaved.length / channels);
  const data = new Float32Array(samples * channels);
  for (let sample = 0; sample < samples; sample++) {
    for (let channel = 0; channel < channels; channel++) {
      data[channel * samples + sample] =
        interleaved[sample * channels + channel];
    }
  }
  return {
    sampleRate,
    samples,
    channels,
    data,
  };
};

const planarToInterleaved = (audio: StereoAudio): Float32Array<ArrayBuffer> => {
  const interleaved = new Float32Array(audio.samples * audio.channels);
  for (let sample = 0; sample < audio.samples; sample++) {
    for (let channel = 0; channel < audio.channels; channel++) {
      interleaved[sample * audio.channels + channel] =
        audio.data[channel * audio.samples + sample];
    }
  }
  return interleaved;
};

export const readAudioFile = async (
  options: ReadAudioFileOptions,
): Promise<StereoAudio> => {
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
      '-acodec',
      'pcm_f32le',
      '-',
    ],
    captureStdout: true,
    logger,
    processName: 'ai.readAudioFile',
  });
  if (output.byteLength === 0) {
    throw new Error('ffmpeg produced no audio data');
  }

  const alignedLength =
    output.byteLength - (output.byteLength % Float32Array.BYTES_PER_ELEMENT);
  const arrayBuffer = new ArrayBuffer(alignedLength);
  new Uint8Array(arrayBuffer).set(output.subarray(0, alignedLength));
  const interleaved: Float32Array<ArrayBuffer> = new Float32Array(
    arrayBuffer,
    0,
    alignedLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return interleavedToPlanar(interleaved, 2, sampleRate);
};

export const writeFlacAudioFile = async (
  options: WriteFlacAudioFileOptions,
): Promise<void> => {
  const { audio, outputSampleRate, outputPath, logger } = options;
  await mkdir(dirname(outputPath), { recursive: true });
  const interleaved = planarToInterleaved(audio);
  await runFfmpeg({
    args: [
      '-f',
      'f32le',
      '-ar',
      audio.sampleRate.toString(),
      '-ac',
      audio.channels.toString(),
      '-i',
      '-',
      '-ar',
      (outputSampleRate ?? audio.sampleRate).toString(),
      '-c:a',
      'flac',
      '-sample_fmt',
      's32',
      '-f',
      'flac',
      '-y',
      outputPath,
    ],
    input: Buffer.from(interleaved.buffer),
    logger,
    processName: 'ai.writeFlacAudioFile',
  });
};
