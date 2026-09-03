import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagePath = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const executableName =
  process.platform === 'win32' ? 'musetric-server.exe' : 'musetric-server';

export const serverResourcesPath = join(packagePath, 'target', 'test-server');

export const setup = (): void => {
  execFileSync(
    'cargo',
    [
      'build',
      '--quiet',
      '--locked',
      '--bin',
      'musetric-server',
      '--manifest-path',
      join(packagePath, 'Cargo.toml'),
    ],
    { stdio: 'inherit' },
  );
  const staging = join(serverResourcesPath, 'server');
  mkdirSync(staging, { recursive: true });
  copyFileSync(
    join(packagePath, 'target', 'debug', executableName),
    join(staging, executableName),
  );
};
