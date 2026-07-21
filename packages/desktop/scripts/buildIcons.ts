import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(join(packageDir, 'src', 'favicon.svg'), 'utf8');
const icon = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
  .render()
  .asPng();

const assetsDir = join(packageDir, 'assets');
await mkdir(assetsDir, { recursive: true });
await writeFile(join(assetsDir, 'icon.png'), Buffer.from(icon));
