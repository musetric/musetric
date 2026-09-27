import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { type ParityDevice } from './parityCases.js';
import { type ParityManifestTensor } from './parityFiles.js';
import { type ParityJob } from './parityJob.js';
import { type ParityDtype } from './parityMeasure.js';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

const isolation = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};

const shell =
  '<!doctype html><meta charset="utf-8"><title>parity</title><script type="module" src="/index.js"></script>';

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const sendFile = (response: ServerResponse, path: string): void => {
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, isolation).end();
    return;
  }
  response.writeHead(200, {
    ...isolation,
    'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
    'content-length': statSync(path).size,
  });
  createReadStream(path).pipe(response);
};

export type DeviceManifest = {
  device: string;
  gpu: string;
  tensors: Record<string, ParityManifestTensor>;
};

type OutputRequest = {
  outDir: string;
  device: string;
  gpu: string;
  manifests: Map<string, DeviceManifest>;
  claimed: boolean;
};

const saveOutput = (
  request: OutputRequest,
  query: URLSearchParams,
  body: Buffer,
): void => {
  const caseName = query.get('case') ?? '';
  const boundary = query.get('boundary') ?? '';
  const source = query.get('source') ?? '';
  const dtype: ParityDtype =
    query.get('dtype') === 'int32' ? 'int32' : 'float32';
  const dir = resolve(request.outDir, 'cases', caseName, request.device);
  mkdirSync(dir, { recursive: true });
  const file = `${boundary}.${source}.bin`;
  writeFileSync(resolve(dir, file), body);
  const manifest = request.manifests.get(caseName) ?? {
    device: request.device,
    gpu: request.gpu,
    tensors: {},
  };
  manifest.gpu = request.gpu;
  manifest.tensors[`${boundary}@${source}`] = {
    file,
    dtype,
    shape: (query.get('shape') ?? '').split(',').map(Number),
  };
  request.manifests.set(caseName, manifest);
  writeFileSync(
    resolve(dir, 'manifest.json'),
    JSON.stringify(manifest, undefined, 2) + '\n',
  );
};

const hubFile = /^\/hf\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(\w[\w.-]*)$/;

export type ParityServerOptions = {
  port: number;
  pageDir: string;
  outDir: string;
  device: string;
  job: ParityJob;
  hub: Map<string, string>;
};

const hubPath = (options: ParityServerOptions, pathname: string): string => {
  const match = hubFile.exec(decodeURIComponent(pathname));
  const directory = match ? options.hub.get(match[1]) : undefined;
  return match && directory !== undefined
    ? join(options.outDir, 'models', directory, match[2])
    : '';
};

export type ParityServer = {
  url: string;
  finished: Promise<void>;
  close: () => Promise<void>;
};

export const startParityServer = (
  options: ParityServerOptions,
): ParityServer => {
  const runId = randomUUID();
  const finished = Promise.withResolvers<void>();
  const outputs: OutputRequest = {
    outDir: options.outDir,
    device: options.device,
    gpu: '',
    manifests: new Map(),
    claimed: false,
  };
  const post = async (
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const body = await readBody(request);
    if (url.searchParams.get('run') !== runId) {
      response.writeHead(409, isolation).end();
      return;
    }
    if (url.pathname === '/output') {
      saveOutput(outputs, url.searchParams, body);
    } else if (url.pathname === '/gpu') {
      outputs.gpu = body.toString();
      console.log(`[${options.device}] ${outputs.gpu}`);
    } else if (url.pathname === '/log') {
      console.log(`[${options.device}] ${body.toString()}`);
    } else if (url.pathname === '/done') {
      finished.resolve();
    } else {
      finished.reject(new Error(`[${options.device}] ${body.toString()}`));
    }
    response.writeHead(204, isolation).end();
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'POST') {
      void post(url, request, response);
      return;
    }
    if (url.pathname === '/') {
      response
        .writeHead(200, { ...isolation, 'content-type': contentTypes['.html'] })
        .end(shell);
      return;
    }
    if (url.pathname === '/job.json') {
      const first = !outputs.claimed && url.searchParams.get('run') === runId;
      outputs.claimed ||= first;
      response
        .writeHead(first ? 200 : 409, {
          ...isolation,
          'content-type': contentTypes['.json'],
        })
        .end(first ? JSON.stringify(options.job) : '{}');
      return;
    }
    if (url.pathname.startsWith('/hf/')) {
      sendFile(response, hubPath(options, url.pathname));
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(
      /^[\\/]+/,
      '',
    );
    const root = /^(models|cases)[\\/]/.test(relative)
      ? options.outDir
      : options.pageDir;
    sendFile(response, join(root, relative));
  });
  server.listen(options.port);
  return {
    url: `http://127.0.0.1:${options.port}/?run=${runId}`,
    finished: finished.promise,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};

const adb = (serial: string, args: string[]): void => {
  execFileSync('adb', ['-s', serial, ...args], { stdio: 'ignore' });
};

const readAdb = (serial: string, args: string[]): string =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim();

const killTree = (pid: number): void => {
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
    });
  } catch {
    process.kill(pid);
  }
};

export type OpenDeviceOptions = {
  device: ParityDevice;
  port: number;
  url: string;
  chrome: string;
};

export const openDevice = (options: OpenDeviceOptions): (() => void) => {
  const { url } = options;
  const { serial } = options.device;
  if (serial === undefined) {
    const profile = mkdtempSync(join(tmpdir(), 'musetric-parity-'));
    const child = spawn(
      options.chrome,
      [
        `--user-data-dir=${profile}`,
        '--force_high_performance_gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        url,
      ],
      { stdio: 'ignore' },
    );
    return () => {
      killTree(child.pid ?? 0);
    };
  }
  adb(serial, ['reverse', `tcp:${options.port}`, `tcp:${options.port}`]);
  const stayOn = readAdb(serial, [
    'shell',
    'settings',
    'get',
    'global',
    'stay_on_while_plugged_in',
  ]);
  if (stayOn === '0') {
    adb(serial, ['shell', 'svc', 'power', 'stayon', 'true']);
  }
  adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  adb(serial, ['shell', 'wm', 'dismiss-keyguard']);
  adb(serial, ['shell', 'am', 'force-stop', 'com.android.chrome']);
  adb(serial, [
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    'com.android.chrome',
  ]);
  return () => {
    adb(serial, ['shell', 'am', 'force-stop', 'com.android.chrome']);
    adb(serial, ['reverse', '--remove', `tcp:${options.port}`]);
  };
};
