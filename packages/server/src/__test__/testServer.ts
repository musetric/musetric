import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const readyPrefix = 'MUSETRIC_PROXY_URL=';

const executableName =
  process.platform === 'win32' ? 'musetric-server.exe' : 'musetric-server';

const hasExited = (child: ChildProcess): boolean => {
  const exitCode = child.exitCode ?? undefined;
  const signalCode = child.signalCode ?? undefined;
  return exitCode !== undefined || signalCode !== undefined;
};

const waitForExit = async (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (hasExited(child)) {
      resolve();
      return;
    }
    child.once('close', () => {
      resolve();
    });
  });

const waitForReady = async (child: ChildProcess): Promise<string> =>
  new Promise((resolve, reject) => {
    const { stdout } = child;
    if (!stdout) {
      reject(new Error('the rust server was started without stdout'));
      return;
    }
    let pending = '';
    const readChunk = (chunk: Buffer): void => {
      const lines = `${pending}${chunk.toString('utf8')}`.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith(readyPrefix)) {
          resolve(line.slice(readyPrefix.length));
        }
      }
    };
    stdout.on('data', readChunk);
    child.once('exit', (code, signal) => {
      reject(
        new Error(
          `the rust server stopped before it was ready (code ${String(code)}, signal ${String(signal)})`,
        ),
      );
    });
  });

export type TestServerOptions = {
  resourcesPath: string;
  databasePath: string;
  blobsPath: string;
  modelsPath: string;
  browserBundlePath: string;
  publicPath: string;
};

export type TestServer = {
  url: string;
  close: () => Promise<void>;
};

export const startTestServer = async (
  options: TestServerOptions,
): Promise<TestServer> => {
  const executablePath = join(options.resourcesPath, 'server', executableName);
  if (!existsSync(executablePath)) {
    throw new Error(`The bundled rust server is missing at ${executablePath}`);
  }
  const child = spawn(executablePath, [
    '--listen',
    '127.0.0.1:0',
    '--database',
    options.databasePath,
    '--blobs',
    options.blobsPath,
    '--models',
    options.modelsPath,
    '--browser-bundle',
    options.browserBundlePath,
    '--public',
    options.publicPath,
    '--processing',
    'false',
  ]);
  const exited = waitForExit(child);
  const url = await waitForReady(child);
  return {
    url,
    close: async () => {
      if (!hasExited(child)) {
        child.stdin.end();
        child.kill();
      }
      await exited;
    },
  };
};
