import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(packageDir, 'src');
const svg = readFileSync(join(sourceDir, 'favicon.svg'), 'utf8');
const icon = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
  .render()
  .asPng();

const assetsDir = join(packageDir, 'assets');
await mkdir(assetsDir, { recursive: true });
await writeFile(join(assetsDir, 'icon.png'), Buffer.from(icon));

const logoPlaceholder = '{{logo}}';
const loadingTemplate = readFileSync(join(sourceDir, 'loading.html'), 'utf8');
if (!loadingTemplate.includes(logoPlaceholder)) {
  throw new Error(`loading.html has no ${logoPlaceholder} placeholder`);
}

const distDir = join(packageDir, 'dist');
await mkdir(distDir, { recursive: true });
await writeFile(
  join(distDir, 'loading.html'),
  loadingTemplate.replace(logoPlaceholder, svg),
);
