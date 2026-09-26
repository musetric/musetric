import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { experimental_getRunnerTask, startVitest } from 'vitest/node';
type PitchExtractRequest = {
  pcmUrl: string;
  pcmStartSeconds: number;
  fromSeconds: number;
  toSeconds: number;
  hopMs: number;
  windowSize: number;
  zeroPaddingFactor: 1 | 2 | 4;
};

type PitchCompareRequest = {
  referencePath: string;
  oursPath: string;
  fromSeconds: number;
  toSeconds: number | undefined;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    pitchExtract?: PitchExtractRequest;
    pitchCompare?: PitchCompareRequest;
  }
}

type PitchExtractOutput = {
  csv: string;
  frames: number;
};

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    pitchExtract?: PitchExtractOutput;
    pitchCompare?: Record<string, number>;
  }
}

const usage = `usage: yarn workspace @musetric/spectrogram measure:pitch <stage> --audio <file> [options]

stages
  reference   run the neural reference (musetric-pitch) and write reference.csv
  extract     run the spectrogram tracker and write <tag>.csv
  compare     score <tag>.csv against reference.csv and write <tag>.compare.json
  all         the three stages in order

options
  --from <seconds>            start of the analysed range (default: 0)
  --to <seconds>              end of the analysed range (default: track end)
  --hop-ms <ms>               frame step of both tracks (default: 5)
  --window-size <samples>     tracker analysis window (default: 4096)
  --zero-padding <1|2|4>      tracker zero padding factor (default: 2)
  --tag <name>                name of the tracker output (default: ours)
  --out <dir>                 output root (default: tmp/pitch)
  --reference-command <cmd>   neural reference command (default: musetric-pitch)`;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sampleRate = 48000;
const contextSeconds = 1;

type PitchStage = 'reference' | 'extract' | 'compare' | 'all';

const stages: readonly PitchStage[] = [
  'reference',
  'extract',
  'compare',
  'all',
];

const readNumber = (
  options: Map<string, string>,
  key: string,
  fallback: number,
): number => {
  const value = options.get(key);
  return value === undefined ? fallback : Number(value);
};

const readZeroPadding = (options: Map<string, string>): 1 | 2 | 4 => {
  const value = readNumber(options, '--zero-padding', 2);
  if (value === 1 || value === 2 || value === 4) {
    return value;
  }
  throw new Error('--zero-padding must be 1, 2 or 4');
};

type PitchArgs = {
  stage: PitchStage;
  audioPath: string;
  fromSeconds: number;
  toSeconds: number | undefined;
  hopMs: number;
  windowSize: number;
  zeroPaddingFactor: 1 | 2 | 4;
  tag: string;
  outDir: string;
  referenceCommand: string;
};

const parseArgs = (argv: readonly string[]): PitchArgs => {
  const [stageName, ...rest] = argv;
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    options.set(rest[index], rest[index + 1] ?? '');
  }
  const stage = stages.find((candidate) => candidate === stageName);
  const audio = options.get('--audio');
  if (!stage || !audio) {
    throw new Error(usage);
  }
  const to = options.get('--to');
  return {
    stage,
    audioPath: resolve(audio),
    fromSeconds: readNumber(options, '--from', 0),
    toSeconds: to === undefined ? undefined : Number(to),
    hopMs: readNumber(options, '--hop-ms', 5),
    windowSize: readNumber(options, '--window-size', 4096),
    zeroPaddingFactor: readZeroPadding(options),
    tag: options.get('--tag') ?? 'ours',
    outDir: resolve(options.get('--out') ?? resolve(packageRoot, 'tmp/pitch')),
    referenceCommand: options.get('--reference-command') ?? 'musetric-pitch',
  };
};

type PitchPaths = {
  stem: string;
  reference: string;
  ours: string;
  compare: string;
};

const buildPaths = (args: PitchArgs): PitchPaths => {
  const range =
    args.toSeconds === undefined
      ? ''
      : `_${args.fromSeconds}-${args.toSeconds}`;
  const stem = basename(args.audioPath, extname(args.audioPath));
  const dir = resolve(args.outDir, `${stem}${range}`);
  mkdirSync(dir, { recursive: true });
  return {
    stem,
    reference: resolve(dir, 'reference.csv'),
    ours: resolve(dir, `${args.tag}.csv`),
    compare: resolve(dir, `${args.tag}.compare.json`),
  };
};

const wholeTrackInput = (
  args: PitchArgs,
  paths: PitchPaths,
  rangedPath: string,
): string => {
  const wholePath = resolve(args.outDir, paths.stem, basename(rangedPath));
  return existsSync(rangedPath) || !existsSync(wholePath)
    ? rangedPath
    : wholePath;
};

const runReference = (args: PitchArgs, paths: PitchPaths): void => {
  const parts = [
    args.referenceCommand,
    `--audio-path "${args.audioPath}"`,
    `--result-path "${paths.reference}"`,
    `--hop-ms ${args.hopMs}`,
    `--from-seconds ${args.fromSeconds}`,
  ];
  if (args.toSeconds !== undefined) {
    parts.push(`--to-seconds ${args.toSeconds}`);
  }
  const result = spawnSync(parts.join(' '), { shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`reference command exited with ${result.status}`);
  }
  console.log(`wrote ${paths.reference}`);
};

type DecodedPcm = {
  url: string;
  startSeconds: number;
  endSeconds: number;
};

const decodePcm = (args: PitchArgs, paths: PitchPaths): DecodedPcm => {
  const startSeconds = Math.max(0, args.fromSeconds - contextSeconds);
  const ffmpegArgs = [
    '-v',
    'error',
    '-ss',
    String(startSeconds),
    '-i',
    args.audioPath,
  ];
  if (args.toSeconds !== undefined) {
    ffmpegArgs.push(
      '-t',
      String(args.toSeconds + contextSeconds - startSeconds),
    );
  }
  ffmpegArgs.push('-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-');
  const result = spawnSync('ffmpeg', ffmpegArgs, { maxBuffer: 2 ** 31 - 1 });
  if (result.status !== 0 || result.stdout.length === 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.toString()}`);
  }
  const relative = `tmp/pitch/pcm/${paths.stem}_${startSeconds}.f32`;
  const target = resolve(packageRoot, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, result.stdout);
  return {
    url: `/${relative}`,
    startSeconds,
    endSeconds:
      startSeconds +
      result.stdout.length / Float32Array.BYTES_PER_ELEMENT / sampleRate,
  };
};

const devNull = new Writable({
  write: (_chunk, _encoding, callback) => {
    callback();
  },
});

type PitchReporterLog = {
  content: string;
  type: string;
};

const pitchReporter = {
  onUserConsoleLog: (log: PitchReporterLog) => {
    const stream = log.type === 'stderr' ? process.stderr : process.stdout;
    stream.write(log.content + '\n');
  },
};

type PitchProvide = {
  pitchExtract?: PitchExtractRequest;
  pitchCompare?: PitchCompareRequest;
};

type PitchMeta = {
  pitchExtract?: PitchExtractOutput;
  pitchCompare?: Record<string, number>;
};

const runPitchTest = async (provide: PitchProvide): Promise<PitchMeta> => {
  const vitest = await startVitest(
    'test',
    [],
    {
      config: resolve(packageRoot, 'vitest.pitch.config.ts'),
      watch: false,
      reporters: [pitchReporter],
      provide,
    },
    undefined,
    { stdout: devNull, stderr: devNull },
  );
  const meta: PitchMeta = {};
  const errors: string[] = [];
  for (const module of vitest.state.getTestModules()) {
    for (const testCase of module.children.allTests()) {
      const task = experimental_getRunnerTask(testCase);
      Object.assign(meta, task.meta);
      for (const error of task.result?.errors ?? []) {
        errors.push(error.message);
      }
    }
  }
  await vitest.close();
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
  return meta;
};

const runExtract = async (
  args: PitchArgs,
  paths: PitchPaths,
): Promise<void> => {
  const pcm = decodePcm(args, paths);
  const meta = await runPitchTest({
    pitchExtract: {
      pcmUrl: pcm.url,
      pcmStartSeconds: pcm.startSeconds,
      fromSeconds: args.fromSeconds,
      toSeconds: Math.min(args.toSeconds ?? Infinity, pcm.endSeconds),
      hopMs: args.hopMs,
      windowSize: args.windowSize,
      zeroPaddingFactor: args.zeroPaddingFactor,
    },
  });
  if (!meta.pitchExtract) {
    throw new Error('extraction produced no result');
  }
  writeFileSync(paths.ours, meta.pitchExtract.csv);
  console.log(`wrote ${paths.ours} (${meta.pitchExtract.frames} frames)`);
};

const runCompare = async (
  args: PitchArgs,
  paths: PitchPaths,
): Promise<void> => {
  const meta = await runPitchTest({
    pitchCompare: {
      referencePath: wholeTrackInput(args, paths, paths.reference),
      oursPath: wholeTrackInput(args, paths, paths.ours),
      fromSeconds: args.fromSeconds,
      toSeconds: args.toSeconds,
    },
  });
  if (!meta.pitchCompare) {
    throw new Error('comparison produced no result');
  }
  const report = {
    audio: basename(args.audioPath),
    from: args.fromSeconds,
    to: args.toSeconds,
    tag: args.tag,
    ...meta.pitchCompare,
  };
  writeFileSync(paths.compare, JSON.stringify(report, undefined, 2) + '\n');
  console.table(meta.pitchCompare);
  console.log(`wrote ${paths.compare}`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const paths = buildPaths(args);
  if (args.stage === 'reference' || args.stage === 'all') {
    runReference(args, paths);
  }
  if (args.stage === 'extract' || args.stage === 'all') {
    await runExtract(args, paths);
  }
  if (args.stage === 'compare' || args.stage === 'all') {
    await runCompare(args, paths);
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
