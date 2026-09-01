import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(join(packageDir, 'src', 'favicon.svg'), 'utf8');
const icon = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
  .render()
  .asPng();
const insetSvg = svg
  .replace(
    /<svg\b[^>]*>/,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><svg x="160" y="160" width="704" height="704" viewBox="0 0 512 512">',
  )
  .replace(/<\/svg>\s*$/, '</svg></svg>');
const insetIcon = new Resvg(insetSvg, { fitTo: { mode: 'width', value: 1024 } })
  .render()
  .asPng();

const genDir = join(packageDir, 'src-tauri', 'gen');
await mkdir(genDir, { recursive: true });
await writeFile(join(genDir, 'icon.png'), Buffer.from(icon));
await writeFile(join(genDir, 'iconForeground.png'), Buffer.from(insetIcon));
await writeFile(
  join(genDir, 'icon.json'),
  `${JSON.stringify(
    {
      default: 'icon.png',
      android_fg: 'iconForeground.png',
      bg_color: '#111111',
    },
    undefined,
    2,
  )}\n`,
);

const androidResDir = join(genDir, 'android', 'app', 'src', 'main', 'res');

if (existsSync(androidResDir)) {
  const androidSplashDir = join(androidResDir, 'drawable-nodpi');
  await mkdir(androidSplashDir, { recursive: true });
  await writeFile(join(androidSplashDir, 'splash_logo.png'), Buffer.from(icon));
  await writeFile(
    join(androidSplashDir, 'splash_system_icon.png'),
    Buffer.from(insetIcon),
  );
}
