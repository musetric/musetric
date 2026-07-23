import { execFileSync } from 'node:child_process';
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

type PackContext = {
  electronPlatformName: string;
  arch: Arch;
};

export const beforePack = (context: PackContext): void => {
  const key = `${context.electronPlatformName}-${Arch[context.arch]}`;
  execFileSync(process.execPath, [fetchScript, key, '--prune'], {
    stdio: 'inherit',
  });
};
