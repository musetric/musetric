import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  columns: number;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    pitchExtract?: PitchExtractRequest;
    pitchCompare?: {
      name: string;
      referencePath: string;
      oursPath: string;
      fromSeconds: number;
      toSeconds: number | undefined;
      worstCount: number;
    }[];
    pitchPerf?: PitchExtractRequest;
  }
}

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    pitchExtract?: { csv: string; frames: number };
    pitchCompare?: { reports: unknown[]; markdown: string };
    pitchPerf?: { result: Record<string, unknown>; markdown: string };
  }
}

const usage = `usage: yarn workspace @musetric/spectrogram measure:pitch <stage> --audio <file|dir> [options]

stages
  reference   run the neural reference (musetric-pitch) and write reference.csv
  extract     run the spectrogram tracker and write <tag>.csv
  compare     score <tag>.csv against reference.csv, write <tag>.compare.md and .json,
              for a directory <out>/<tag>.corpus.md and .json
  perf        time the pitch kernels per batch and a render of the window, write <tag>.perf.json
  all         reference, extract and compare in order; with --audio <dir>, on each track

options
  --from <seconds>            start of the analysed range (default: 0)
  --to <seconds>              end of the analysed range (default: track end)
  --hop-ms <ms>               frame step of the reference (default: 5; the tracker keeps its own 5 ms)
  --window-size <samples>     window of the display spectrogram (default: 4096)
  --zero-padding <1|2|4>      zero padding of the display spectrogram (default: 2)
  --columns <count>           columns of the rendered view (default: 4096, perf 1920)
  --tag <name>                name of the tracker output (default: ours)
  --out <dir>                 output root (default: tmp/pitch)
  --worst <count>             worst 5 s windows to list (default: 10)
  --reference-command <cmd>   neural reference command (default: musetric-pitch)`;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sampleRate = 48000;
const contextSeconds = 1;
const audioExtensions = new Set(['.flac', '.wav', '.mp3', '.ogg', '.m4a']);

const stages = ['reference', 'extract', 'compare', 'perf', 'all'] as const;

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

const listAudio = (path: string): string[] => {
  const resolved = resolve(path);
  if (!statSync(resolved).isDirectory()) {
    return [resolved];
  }
  return readdirSync(resolved)
    .filter((name) => audioExtensions.has(extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => resolve(resolved, name));
};

type PitchArgs = {
  stage: (typeof stages)[number];
  audioPaths: string[];
  fromSeconds: number;
  toSeconds: number | undefined;
  hopMs: number;
  windowSize: number;
  zeroPaddingFactor: 1 | 2 | 4;
  columns: number;
  tag: string;
  outDir: string;
  worstCount: number;
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
    audioPaths: listAudio(audio),
    fromSeconds: readNumber(options, '--from', 0),
    toSeconds: to === undefined ? undefined : Number(to),
    hopMs: readNumber(options, '--hop-ms', 5),
    windowSize: readNumber(options, '--window-size', 4096),
    zeroPaddingFactor: readZeroPadding(options),
    columns: readNumber(options, '--columns', stage === 'perf' ? 1920 : 4096),
    tag: options.get('--tag') ?? 'ours',
    outDir: resolve(options.get('--out') ?? resolve(packageRoot, 'tmp/pitch')),
    worstCount: readNumber(options, '--worst', 10),
    referenceCommand: options.get('--reference-command') ?? 'musetric-pitch',
  };
};

type PitchTrack = {
  audioPath: string;
  stem: string;
  reference: string;
  ours: string;
  compare: string;
  perf: string;
};

const buildTrack = (args: PitchArgs, audioPath: string): PitchTrack => {
  const range =
    args.toSeconds === undefined
      ? ''
      : `_${args.fromSeconds}-${args.toSeconds}`;
  const stem = basename(audioPath, extname(audioPath));
  const dir = resolve(args.outDir, `${stem}${range}`);
  mkdirSync(dir, { recursive: true });
  return {
    audioPath,
    stem,
    reference: resolve(dir, 'reference.csv'),
    ours: resolve(dir, `${args.tag}.csv`),
    compare: resolve(dir, `${args.tag}.compare`),
    perf: resolve(dir, `${args.tag}.perf.json`),
  };
};

const wholeTrackInput = (
  args: PitchArgs,
  track: PitchTrack,
  rangedPath: string,
): string => {
  const wholePath = resolve(args.outDir, track.stem, basename(rangedPath));
  return existsSync(rangedPath) || !existsSync(wholePath)
    ? rangedPath
    : wholePath;
};

const runReference = (args: PitchArgs, track: PitchTrack): void => {
  const parts = [
    args.referenceCommand,
    `--audio-path "${track.audioPath}"`,
    `--result-path "${track.reference}"`,
    `--hop-ms ${args.hopMs}`,
    `--from-seconds ${args.fromSeconds}`,
    ...(args.toSeconds === undefined ? [] : [`--to-seconds ${args.toSeconds}`]),
  ];
  const result = spawnSync(parts.join(' '), { shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`reference command exited with ${result.status}`);
  }
  console.log(`wrote ${track.reference}`);
};

const buildExtractRequest = (
  args: PitchArgs,
  track: PitchTrack,
): PitchExtractRequest => {
  const startSeconds = Math.max(0, args.fromSeconds - contextSeconds);
  const ffmpegArgs = [
    '-v',
    'error',
    '-ss',
    String(startSeconds),
    '-i',
    track.audioPath,
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
  const relative = `tmp/pitch/pcm/${track.stem}_${startSeconds}.f32`;
  const target = resolve(packageRoot, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, result.stdout);
  const endSeconds =
    startSeconds +
    result.stdout.length / Float32Array.BYTES_PER_ELEMENT / sampleRate;
  return {
    pcmUrl: `/${relative}`,
    pcmStartSeconds: startSeconds,
    fromSeconds: args.fromSeconds,
    toSeconds: Math.min(args.toSeconds ?? Infinity, endSeconds),
    hopMs: args.hopMs,
    windowSize: args.windowSize,
    zeroPaddingFactor: args.zeroPaddingFactor,
    columns: args.columns,
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

type PitchProvide = NonNullable<Parameters<typeof startVitest>[2]>['provide'];
type PitchMeta = ReturnType<typeof experimental_getRunnerTask>['meta'];

const runPitchTest = async (
  provide: PitchProvide,
  outDir: string,
): Promise<PitchMeta> => {
  const vitest = await startVitest(
    'test',
    [],
    {
      config: resolve(packageRoot, 'vitest.pitch.config.ts'),
      watch: false,
      reporters: [pitchReporter],
      provide,
    },
    { server: { fs: { allow: [resolve(packageRoot, '../..'), outDir] } } },
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
  track: PitchTrack,
): Promise<void> => {
  const meta = await runPitchTest(
    { pitchExtract: buildExtractRequest(args, track) },
    args.outDir,
  );
  if (!meta.pitchExtract) {
    throw new Error('extraction produced no result');
  }
  writeFileSync(track.ours, meta.pitchExtract.csv);
  console.log(`wrote ${track.ours} (${meta.pitchExtract.frames} frames)`);
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, JSON.stringify(value, undefined, 2) + '\n');
};

const runCompare = async (
  args: PitchArgs,
  tracks: PitchTrack[],
): Promise<void> => {
  const pitchCompare = tracks.map((track) => ({
    name: track.stem,
    referencePath: wholeTrackInput(args, track, track.reference),
    oursPath: wholeTrackInput(args, track, track.ours),
    fromSeconds: args.fromSeconds,
    toSeconds: args.toSeconds,
    worstCount: args.worstCount,
  }));
  const meta = await runPitchTest({ pitchCompare }, args.outDir);
  const output = meta.pitchCompare;
  if (output?.reports.length !== tracks.length) {
    throw new Error('comparison produced no result');
  }
  const target =
    tracks.length === 1
      ? tracks[0].compare
      : resolve(args.outDir, `${args.tag}.corpus`);
  writeFileSync(`${target}.md`, output.markdown + '\n');
  writeJson(`${target}.json`, output.reports);
  console.log(output.markdown);
  console.log(`wrote ${target}.md and ${target}.json`);
};

const runPerf = async (args: PitchArgs, track: PitchTrack): Promise<void> => {
  const { pitchPerf } = await runPitchTest(
    { pitchPerf: buildExtractRequest(args, track) },
    args.outDir,
  );
  if (!pitchPerf) {
    throw new Error('the measurement produced no result');
  }
  const report = {
    audio: basename(track.audioPath),
    from: args.fromSeconds,
    to: args.toSeconds,
    tag: args.tag,
    ...pitchPerf.result,
  };
  writeJson(track.perf, report);
  console.log(pitchPerf.markdown);
  console.log(`wrote ${track.perf}`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const tracks = args.audioPaths.map((audioPath) =>
    buildTrack(args, audioPath),
  );
  if (args.stage === 'perf') {
    if (tracks.length !== 1) {
      throw new Error('perf takes one audio file');
    }
    await runPerf(args, tracks[0]);
    return;
  }
  for (const track of tracks) {
    if (args.stage === 'reference' || args.stage === 'all') {
      runReference(args, track);
    }
    if (args.stage === 'extract' || args.stage === 'all') {
      await runExtract(args, track);
    }
  }
  if (args.stage === 'compare' || args.stage === 'all') {
    await runCompare(args, tracks);
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
