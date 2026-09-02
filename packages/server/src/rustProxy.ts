import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagePath = dirname(dirname(fileURLToPath(import.meta.url)));
const readyPrefix = 'MUSETRIC_PROXY_URL=';
const addressInUseMarker = 'MUSETRIC_PROXY_ERROR=address-in-use';

const executableName =
  process.platform === 'win32' ? 'musetric-server.exe' : 'musetric-server';

export const isAddressInUseError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(addressInUseMarker);

export type RustProxyTls = {
  certificate: string;
  privateKey: string;
};

type TlsFiles = {
  directory: string;
  certificatePath: string;
  privateKeyPath: string;
};

const createTlsFiles = async (tls: RustProxyTls): Promise<TlsFiles> => {
  const directory = await mkdtemp(join(tmpdir(), 'musetric-rust-proxy-'));
  const certificatePath = join(directory, 'certificate.pem');
  const privateKeyPath = join(directory, 'private-key.pem');
  await Promise.all([
    writeFile(certificatePath, tls.certificate, { mode: 0o600 }),
    writeFile(privateKeyPath, tls.privateKey, { mode: 0o600 }),
  ]);
  return { directory, certificatePath, privateKeyPath };
};

export type StartRustProxyOptions = {
  upstream: string;
  listen: string;
  resourcesPath?: string;
  tls?: RustProxyTls;
  onLog?: (line: string) => void;
};

type Command = {
  command: string;
  args: string[];
};

const createCommand = (
  options: StartRustProxyOptions,
  tlsFiles: TlsFiles | undefined,
): Command => {
  const args = ['--upstream', options.upstream, '--listen', options.listen];
  if (tlsFiles !== undefined) {
    args.push(
      '--certificate',
      tlsFiles.certificatePath,
      '--private-key',
      tlsFiles.privateKeyPath,
    );
  }
  if (options.resourcesPath === undefined) {
    return {
      command: 'cargo',
      args: [
        'run',
        '--quiet',
        '--manifest-path',
        join(packagePath, 'Cargo.toml'),
        '--',
        ...args,
      ],
    };
  }

  const executablePath = join(options.resourcesPath, 'server', executableName);
  if (!existsSync(executablePath)) {
    throw new Error(`The bundled rust proxy is missing at ${executablePath}`);
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
  onLog: ((line: string) => void) | undefined,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const { stdout, stderr } = child;
    if (!stdout || !stderr) {
      reject(new Error('the rust proxy was started without output streams'));
      return;
    }

    const startupLines: string[] = [];
    let ready = false;
    const fail = (message: string): void => {
      reject(new Error([message, ...startupLines].join('\n').trimEnd()));
    };
    const handleLine = (line: string): void => {
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
      fail(`the rust proxy failed to start (${error.message})`);
    });
    child.once('exit', (code, signal) => {
      const status = `code ${String(code)}, signal ${String(signal)}`;
      if (ready) {
        onLog?.(`the rust proxy exited (${status})`);
        return;
      }
      fail(`the rust proxy stopped before it was ready (${status})`);
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
  tlsFiles: TlsFiles | undefined,
): Promise<void> => {
  if (!hasExited(child)) {
    child.stdin?.end();
    child.kill();
  }
  await exited;
  if (tlsFiles !== undefined) {
    await rm(tlsFiles.directory, { force: true, recursive: true });
  }
};

export type RustProxy = {
  url: string;
  close: () => Promise<void>;
};

export const startRustProxy = async (
  options: StartRustProxyOptions,
): Promise<RustProxy> => {
  const tlsFiles =
    options.tls === undefined ? undefined : await createTlsFiles(options.tls);
  const { command, args } = createCommand(options, tlsFiles);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = waitForExit(child);

  try {
    const url = await waitForReady(child, options.onLog);
    let closing: Promise<void> | undefined = undefined;
    const close = async (): Promise<void> => {
      if (closing !== undefined) {
        await closing;
        return;
      }
      closing = stopChild(child, exited, tlsFiles);
      await closing;
    };
    return { url, close };
  } catch (error) {
    await stopChild(child, exited, tlsFiles);
    throw error;
  }
};
