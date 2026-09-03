import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch } from 'electron-builder';

const hookDir = dirname(fileURLToPath(import.meta.url));
const fetchScript = join(
  hookDir,
  '..',
  '..',
  'ffmpeg',
  'scripts',
  'fetchFfmpeg.ts',
);
const serverManifest = join(hookDir, '..', '..', 'server', 'Cargo.toml');
const serverTargetDir = join(hookDir, '..', '..', 'server', 'target');
const stagingDir = join(hookDir, '..', 'gen-assets', 'server');

const rustTargets: Record<string, string | undefined> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

const buildServer = (key: string): void => {
  const target = rustTargets[key];
  if (target === undefined) {
    throw new Error(`The rust server has no known target for ${key}`);
  }
  execFileSync('rustup', ['target', 'add', target], { stdio: 'inherit' });
  execFileSync(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      '--target',
      target,
      '--manifest-path',
      serverManifest,
    ],
    { stdio: 'inherit' },
  );

  const executable = key.startsWith('win32')
    ? 'musetric-server.exe'
    : 'musetric-server';
  rmSync(stagingDir, { force: true, recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  copyFileSync(
    join(serverTargetDir, target, 'release', executable),
    join(stagingDir, executable),
  );
};

type PackContext = {
  electronPlatformName: string;
  arch: Arch;
};

export const beforePack = (context: PackContext): void => {
  const key = `${context.electronPlatformName}-${Arch[context.arch]}`;
  execFileSync(process.execPath, [fetchScript, key, '--prune'], {
    stdio: 'inherit',
  });
  buildServer(key);
};
