import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ffmpegPath, ffprobePath } from '@musetric/ffmpeg';
import { type Logger } from '@musetric/utils';

const execFileAsync = promisify(execFile);

const packagePath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const sampleRate = 48000;

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const fixtureExpression = [
  '0.6*sin(440*2*PI*t)*(0.2+0.8*abs(sin(1.3*t)))',
  '0.45*sin(523.25*2*PI*t+sin(3*t))*(0.1+0.9*abs(sin(0.7*t)))',
].join('|');

const createFixture = async (fixturePath: string): Promise<void> => {
  await execFileAsync(ffmpegPath(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=exprs=${fixtureExpression}:s=${String(sampleRate)}:d=2.5`,
    '-c:a',
    'pcm_s16le',
    fixturePath,
  ]);
};

const runExample = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      join(packagePath, 'Cargo.toml'),
      '--package',
      'musetric-media',
      '--example',
      'media',
      '--',
      '--ffmpeg',
      ffmpegPath(),
      '--ffprobe',
      ffprobePath(),
      ...args,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
};

export type MediaWorkspace = {
  fixturePath: string;
  path: (name: string) => string;
  read: (name: string) => Buffer;
  runRust: (args: string[]) => Promise<string>;
  readRust: (args: string[]) => Promise<unknown>;
};

export const withMediaWorkspace = async <Result>(
  run: (workspace: MediaWorkspace) => Promise<Result>,
): Promise<Result> => {
  const root = mkdtempSync(join(tmpdir(), 'musetric-media-'));
  const fixturePath = join(root, 'fixture.wav');
  try {
    await createFixture(fixturePath);
    return await run({
      fixturePath,
      path: (name) => join(root, name),
      read: (name) => readFileSync(join(root, name)),
      runRust: runExample,
      readRust: async (args) => JSON.parse(await runExample(args)),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
