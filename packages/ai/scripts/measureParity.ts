import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { startVitest, type TestCase } from 'vitest/node';

type ParityCase = {
  name: string;
};

type ParityCaseFile = {
  sources: unknown;
  cases: ParityCase[];
};

type ParityDevice = {
  name: string;
  serial?: string;
};

type ParityPrepareRequest = ParityCaseFile & {
  outDir: string;
  referenceCommand: string;
};

type ParityRunRequest = {
  outDir: string;
  cases: ParityCase[];
  device: ParityDevice;
  port: number;
  chrome: string;
  timeoutMinutes: number;
};

type ParityCompareRequest = {
  outDir: string;
  cases: string[];
  devices: string[];
  checks: unknown;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    parityPrepare?: ParityPrepareRequest;
    parityRun?: ParityRunRequest;
    parityCompare?: ParityCompareRequest;
  }
}

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    parityCompare?: string;
    parityFailed?: number;
  }
}

const usage = `usage: yarn workspace @musetric/ai measure:parity <stage> [options]

stages
  prepare   download the pinned models and case audio, write each case's reference with the toolkit
  run       run every case in a page on each device: wasm, WebGPU and the product's own runtime
  compare   score every boundary against its declared threshold and write report.md
  all       the three stages in order

options
  --cases <a,b|all>             cases from scripts/parityCases.json (default: all)
  --devices <pc,name=serial>    the desktop and phones over adb (default: pc)
  --out <dir>                   output root (default: tmp/parity)
  --reference-command <cmd>     toolkit reference command (default: musetric-parity)
  --chrome <path>               desktop Chrome (default: its standard install path)
  --port <n>                    page server port (default: 8131)
  --timeout-minutes <n>         per device (default: 20)`;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const stages = ['prepare', 'run', 'compare', 'all'] as const;

const chromePaths: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
};

const parseDevices = (value: string): ParityDevice[] =>
  value.split(',').map((entry) => {
    const [name, serial] = entry.split('=');
    return entry.includes('=') ? { name, serial } : { name };
  });

type ParityStage = (typeof stages)[number];

type ParityArgs = {
  stage: ParityStage;
  caseNames: string[] | undefined;
  devices: ParityDevice[];
  outDir: string;
  referenceCommand: string;
  chrome: string;
  port: number;
  timeoutMinutes: number;
};

const parseArgs = (argv: readonly string[]): ParityArgs => {
  const [stageName, ...rest] = argv;
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    options.set(rest[index], rest[index + 1] ?? '');
  }
  const stage = stages.find((candidate) => candidate === stageName);
  if (!stage) {
    throw new Error(usage);
  }
  const cases = options.get('--cases');
  return {
    stage,
    caseNames:
      cases === undefined || cases === 'all' ? undefined : cases.split(','),
    devices: parseDevices(options.get('--devices') ?? 'pc'),
    outDir: resolve(options.get('--out') ?? resolve(packageRoot, 'tmp/parity')),
    referenceCommand: options.get('--reference-command') ?? 'musetric-parity',
    chrome:
      options.get('--chrome') ??
      chromePaths[process.platform] ??
      'google-chrome',
    port: Number(options.get('--port') ?? 8131),
    timeoutMinutes: Number(options.get('--timeout-minutes') ?? 20),
  };
};

const isCaseFile = (value: unknown): value is ParityCaseFile => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  return 'cases' in value && Array.isArray(value.cases);
};

const readCases = (args: ParityArgs): ParityCaseFile => {
  const rawCases: unknown = JSON.parse(
    readFileSync(resolve(packageRoot, 'scripts/parityCases.json'), 'utf8'),
  );
  if (!isCaseFile(rawCases)) {
    throw new Error('scripts/parityCases.json has no cases');
  }
  const names = args.caseNames;
  return {
    sources: rawCases.sources,
    cases:
      names === undefined
        ? rawCases.cases
        : rawCases.cases.filter((testCase) => names.includes(testCase.name)),
  };
};

const readChecks = (): unknown =>
  JSON.parse(
    readFileSync(resolve(packageRoot, 'scripts/parityChecks.json'), 'utf8'),
  );

const devNull = new Writable({
  write: (_chunk, _encoding, callback) => {
    callback();
  },
});

type ParityReporterLog = {
  content: string;
  type: string;
};

const parityReporter = {
  onUserConsoleLog: (log: ParityReporterLog) => {
    const stream = log.type === 'stderr' ? process.stderr : process.stdout;
    stream.write(log.content + '\n');
  },
};

type ParityProvide = NonNullable<Parameters<typeof startVitest>[2]>['provide'];
type ParityMeta = ReturnType<TestCase['meta']>;

const runParityTest = async (
  file: string,
  provide: ParityProvide,
): Promise<ParityMeta> => {
  const vitest = await startVitest(
    'test',
    [file],
    {
      config: resolve(packageRoot, 'vitest.parity.config.ts'),
      watch: false,
      reporters: [parityReporter],
      provide,
    },
    undefined,
    { stdout: devNull, stderr: devNull },
  );
  const tests = vitest.state
    .getTestModules()
    .flatMap((module) => [...module.children.allTests()]);
  const failures = tests.flatMap((test) => test.result().errors ?? []);
  const meta = tests.reduce<ParityMeta>(
    (collected, test) => ({ ...collected, ...test.meta() }),
    {},
  );
  await vitest.close();
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.message).join('; '));
  }
  return meta;
};

const runPrepare = async (
  args: ParityArgs,
  caseFile: ParityCaseFile,
): Promise<void> => {
  await runParityTest('parityPrepare', {
    parityPrepare: {
      outDir: args.outDir,
      referenceCommand: args.referenceCommand,
      ...caseFile,
    },
  });
};

const runDevices = async (
  args: ParityArgs,
  caseFile: ParityCaseFile,
): Promise<void> => {
  for (const device of args.devices) {
    await runParityTest('parityRun', {
      parityRun: {
        outDir: args.outDir,
        cases: caseFile.cases,
        device,
        port: args.port,
        chrome: args.chrome,
        timeoutMinutes: args.timeoutMinutes,
      },
    });
  }
};

const runCompare = async (
  args: ParityArgs,
  caseFile: ParityCaseFile,
): Promise<number> => {
  const meta = await runParityTest('parityCompare', {
    parityCompare: {
      outDir: args.outDir,
      cases: caseFile.cases.map((testCase) => testCase.name),
      devices: args.devices.map((device) => device.name),
      checks: readChecks(),
    },
  });
  console.log(meta.parityCompare ?? '');
  console.log(`wrote ${resolve(args.outDir, 'report.md')}`);
  return meta.parityFailed ?? 0;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const caseFile = readCases(args);
  if (args.stage === 'prepare' || args.stage === 'all') {
    await runPrepare(args, caseFile);
  }
  if (args.stage === 'run' || args.stage === 'all') {
    await runDevices(args, caseFile);
  }
  if (args.stage === 'compare' || args.stage === 'all') {
    const failed = await runCompare(args, caseFile);
    process.exitCode = failed > 0 ? 1 : 0;
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
