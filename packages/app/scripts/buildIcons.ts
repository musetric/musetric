import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const iconBackground = '#111111';
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
const glyphSvg = svg.replace(/<rect\b[^>]*\/>/, '');
const glyphIcon = new Resvg(glyphSvg, { fitTo: { mode: 'width', value: 1024 } })
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
      bg_color: iconBackground,
    },
    undefined,
    2,
  )}\n`,
);

const appIconDir = join(genDir, 'AppIcon.icon');
await mkdir(join(appIconDir, 'Assets'), { recursive: true });
await writeFile(
  join(appIconDir, 'Assets', 'glyph.png'),
  Buffer.from(glyphIcon),
);
await writeFile(
  join(appIconDir, 'icon.json'),
  `${JSON.stringify(
    {
      fill: {
        'linear-gradient': [
          'srgb:0.16471,0.16471,0.16471,1.00000',
          'srgb:0.06667,0.06667,0.06667,1.00000',
        ],
        orientation: {
          start: { x: 0.5, y: 0 },
          stop: { x: 0.5, y: 1 },
        },
      },
      groups: [
        {
          layers: [{ glass: false, 'image-name': 'glyph.png', name: 'glyph' }],
        },
      ],
      'supported-platforms': { squares: ['macOS'] },
    },
    undefined,
    2,
  )}\n`,
);

if (process.platform === 'darwin') {
  const actoolDir = await mkdtemp(join(tmpdir(), 'musetric-actool-'));
  execFileSync(
    'xcrun',
    [
      'actool',
      appIconDir,
      '--compile',
      actoolDir,
      '--output-format',
      'human-readable-text',
      '--errors',
      '--warnings',
      '--output-partial-info-plist',
      join(actoolDir, 'info.plist'),
      '--app-icon',
      'AppIcon',
      '--include-all-app-icons',
      '--enable-on-demand-resources',
      'NO',
      '--development-region',
      'en',
      '--target-device',
      'mac',
      '--minimum-deployment-target',
      '26.0',
      '--platform',
      'macosx',
    ],
    { stdio: 'inherit' },
  );
  await copyFile(join(actoolDir, 'Assets.car'), join(genDir, 'Assets.car'));
  await rm(actoolDir, { recursive: true });
}

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

const tauri = createRequire(import.meta.url).resolve(
  '@tauri-apps/cli/tauri.js',
);
execFileSync(
  process.execPath,
  [
    tauri,
    'icon',
    '-o',
    join(packageDir, 'src-tauri', 'gen-assets'),
    join(genDir, 'icon.json'),
  ],
  { cwd: packageDir, stdio: 'inherit' },
);

const pngChunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};

const encodeOpaquePng = (
  width: number,
  height: number,
  rgba: Buffer,
): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rowLength = width * 3 + 1;
  const rows = Buffer.alloc(height * rowLength);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const target =
      Math.floor(pixel / width) * rowLength + 1 + (pixel % width) * 3;
    rgba.copy(rows, target, pixel * 4, pixel * 4 + 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const iosIconDir = join(
  genDir,
  'apple',
  'Assets.xcassets',
  'AppIcon.appiconset',
);

if (existsSync(iosIconDir)) {
  const names = readdirSync(iosIconDir).filter((name) => name.endsWith('.png'));
  for (const name of names) {
    const path = join(iosIconDir, name);
    const size = readFileSync(path).readUInt32BE(16);
    const rendered = new Resvg(svg, {
      background: iconBackground,
      fitTo: { mode: 'width', value: size },
    }).render();
    await writeFile(
      path,
      encodeOpaquePng(rendered.width, rendered.height, rendered.pixels),
    );
  }
}
