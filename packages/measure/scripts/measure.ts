import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type ProvidedContext } from 'vitest';
import { startVitest } from 'vitest/node';

type DeviceKind = 'android' | 'chrome' | 'desktop';

type MeasureCommand = 'timing' | 'delay' | 'sound';

type MeasureRequest = {
  command: MeasureCommand;
  device: { kind: DeviceKind; serial?: string; port: number };
  outDir: string;
  reanalyze: boolean;
  calibrate: boolean;
  takeOnly: boolean;
  seconds: number;
  tempos: number[];
  startSeconds: number;
  takeSeconds: number;
  volumeDb: number;
  signal?: string;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    measureRequest?: MeasureRequest;
  }
}

const usage = `usage: yarn workspace @musetric/measure measure:<timing|delay|sound> [options]

  measure:timing   the playhead against the heard metronome click, and the take against the beats
  measure:delay    how far the voice line, the spectrogram and the newest audio trail the playhead
  measure:sound    the take against the browser path on a played synthetic file, and gaps in a long take

options
  --device <android|chrome|desktop>  the page to drive (default: android)
  --serial <serial>                  the phone, when adb sees several
  --port <n>                         the debugging port (default: 9333, 9334, 9335 by device)
  --out <dir>                        where runs and report.md go (default: tmp/measure/<command>)
  --reanalyze                        analyze the runs already in --out, without a device
  --keep-calibration                 measure with the stored calibration instead of calibrating first
  --seconds <n>                      take length for timing and delay (default: 20)
  --tempos <a,b>                     timing tempos (default: 1)
  --start <seconds>                  where delay and sound takes start in the song (default: 30)
  --take-seconds <n>                 the sound take with the song (default: 60)
  --take-only                        sound: only the take with the song, without the file comparison
  --volume <dB>                      gain of the file the PC plays (default: 0)
  --signal <wav>                     a file to play instead of the generated one`;

const commands: readonly MeasureCommand[] = ['timing', 'delay', 'sound'];
const devices: readonly DeviceKind[] = ['android', 'chrome', 'desktop'];
const defaultPorts: Record<DeviceKind, number> = {
  android: 9333,
  chrome: 9334,
  desktop: 9335,
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const parseOptions = (argv: string[]) => {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        device: { type: 'string', default: 'android' },
        serial: { type: 'string' },
        port: { type: 'string' },
        out: { type: 'string' },
        reanalyze: { type: 'boolean', default: false },
        'keep-calibration': { type: 'boolean', default: false },
        'take-only': { type: 'boolean', default: false },
        seconds: { type: 'string', default: '20' },
        tempos: { type: 'string', default: '1' },
        start: { type: 'string', default: '30' },
        'take-seconds': { type: 'string', default: '60' },
        volume: { type: 'string', default: '0' },
        signal: { type: 'string' },
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\n\n${usage}`, { cause: error });
  }
};

const readRequest = (argv: string[]): MeasureRequest => {
  const { values, positionals } = parseOptions(argv);
  const command = commands.find((candidate) => candidate === positionals[0]);
  const kind = devices.find((candidate) => candidate === values.device);
  if (!command || !kind) {
    throw new Error(usage);
  }
  return {
    command,
    device: {
      kind,
      serial: values.serial,
      port: Number(values.port ?? defaultPorts[kind]),
    },
    outDir: resolve(values.out ?? resolve(packageRoot, 'tmp/measure', command)),
    reanalyze: values.reanalyze,
    calibrate: !values['keep-calibration'],
    takeOnly: values['take-only'],
    seconds: Number(values.seconds),
    tempos: values.tempos.split(',').map(Number),
    startSeconds: Number(values.start),
    takeSeconds: Number(values['take-seconds']),
    volumeDb: Number(values.volume),
    signal: values.signal === undefined ? undefined : resolve(values.signal),
  };
};

const devNull = new Writable({
  write: (_chunk, _encoding, callback) => {
    callback();
  },
});

type MeasureReporterLog = {
  content: string;
  type: string;
};

const measureReporter = {
  onUserConsoleLog: (log: MeasureReporterLog) => {
    const stream = log.type === 'stderr' ? process.stderr : process.stdout;
    stream.write(log.content + '\n');
  },
};

const runMeasure = async (provide: Partial<ProvidedContext>) => {
  const vitest = await startVitest(
    ['measure.measure'],
    {
      config: resolve(packageRoot, 'vitest.measure.config.ts'),
      watch: false,
      reporters: [measureReporter],
      provide,
    },
    undefined,
    { stdout: devNull, stderr: devNull },
  );
  const failures = vitest.state
    .getTestModules()
    .flatMap((module) => [...module.children.allTests()])
    .flatMap((test) => test.result().errors ?? []);
  await vitest.close();
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.message).join('; '));
  }
};

try {
  await runMeasure({ measureRequest: readRequest(process.argv.slice(2)) });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
