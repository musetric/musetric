import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMigrationReader,
  type MigrationReader,
  type MigrationReport,
} from './migration.js';

const packagePath = dirname(dirname(fileURLToPath(import.meta.url)));
const readyPrefix = 'MUSETRIC_PROXY_URL=';

const executableName =
  process.platform === 'win32' ? 'musetric-server.exe' : 'musetric-server';

export type StartServerProcessOptions = {
  databasePath: string;
  blobsPath: string;
  modelsPath: string;
  browserBundlePath: string;
  publicPath: string;
  resourcesPath?: string;
  onLog?: (line: string) => void;
};

type Command = {
  command: string;
  args: string[];
};

const createCommand = (options: StartServerProcessOptions): Command => {
  const args = [
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
  ];
  if (options.resourcesPath === undefined) {
    return {
      command: 'cargo',
      args: [
        'run',
        '--quiet',
        '--manifest-path',
        join(packagePath, '..', 'server', 'Cargo.toml'),
        '--',
        ...args,
      ],
    };
  }

  const executablePath = join(options.resourcesPath, 'server', executableName);
  if (!existsSync(executablePath)) {
    throw new Error(`The bundled rust server is missing at ${executablePath}`);
  }
  return { command: executablePath, args };
};

const createLineReader = (
  onLine: (line: string) => void,
): ((chunk: Buffer) => void) => {
  let pending = '';
  return (chunk) => {
    const lines = `${pending}${chunk.toString('utf8')}`.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      onLine(line);
    }
  };
};

const waitForReady = async (
  child: ChildProcess,
  migrations: MigrationReader,
  onLog: ((line: string) => void) | undefined,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const { stdout, stderr } = child;
    if (!stdout || !stderr) {
      reject(new Error('the rust server was started without output streams'));
      return;
    }

    const startupLines: string[] = [];
    let ready = false;
    const fail = (message: string): void => {
      reject(new Error([message, ...startupLines].join('\n').trimEnd()));
    };
    const handleLine = (line: string): void => {
      if (migrations.handleLine(line)) {
        return;
      }
      if (!ready && line.startsWith(readyPrefix)) {
        ready = true;
        resolve(line.slice(readyPrefix.length));
        return;
      }
      if (!ready) {
        startupLines.push(line);
      }
      onLog?.(line);
    };

    stdout.on('data', createLineReader(handleLine));
    stderr.on('data', createLineReader(handleLine));
    child.once('error', (error) => {
      fail(`the rust server failed to start (${error.message})`);
    });
    child.once('exit', (code, signal) => {
      const status = `code ${String(code)}, signal ${String(signal)}`;
      if (ready) {
        onLog?.(`the rust server exited (${status})`);
        return;
      }
      fail(`the rust server stopped before it was ready (${status})`);
    });
  });

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

const stopChild = async (
  child: ChildProcess,
  exited: Promise<void>,
): Promise<void> => {
  if (!hasExited(child)) {
    child.stdin?.end();
    child.kill();
  }
  await exited;
};

export type ServerProcess = {
  url: string;
  migration: MigrationReport;
  close: () => Promise<void>;
};

export const startServerProcess = async (
  options: StartServerProcessOptions,
): Promise<ServerProcess> => {
  const { command, args } = createCommand(options);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = waitForExit(child);
  const migrations = createMigrationReader();

  try {
    const url = await waitForReady(child, migrations, options.onLog);
    const migration = migrations.report();
    if (migration === undefined) {
      throw new Error('the rust server started without reporting its schema');
    }
    let closing: Promise<void> | undefined = undefined;
    const close = async (): Promise<void> => {
      if (closing !== undefined) {
        await closing;
        return;
      }
      closing = stopChild(child, exited);
      await closing;
    };
    return { url, migration, close };
  } catch (error) {
    await stopChild(child, exited);
    throw migrations.fail(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
};
