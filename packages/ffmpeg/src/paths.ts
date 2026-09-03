import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

const asarMarker = `${sep}app.asar${sep}`;
const unpackedMarker = `${sep}app.asar.unpacked${sep}`;

const fromUnpackedAsar = (path: string): string =>
  path.includes(asarMarker) ? path.replace(asarMarker, unpackedMarker) : path;

const platformKey = `${process.platform}-${process.arch}`;
const exeSuffix = process.platform === 'win32' ? '.exe' : '';

const bundledDir = fromUnpackedAsar(join(packageDir, 'resources', platformKey));

const bundledBinary = (name: 'ffmpeg'): string => {
  const path = join(bundledDir, `${name}${exeSuffix}`);
  if (!existsSync(path)) {
    throw new Error(`Bundled ${name} is missing at ${path}.`);
  }
  return path;
};

export const ffmpegPath = (): string => bundledBinary('ffmpeg');
