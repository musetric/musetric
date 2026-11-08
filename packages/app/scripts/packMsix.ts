import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const readArg = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) {
    throw new Error(
      `Usage: packMsix.ts --target <rust target> --build <number>`,
    );
  }
  return value;
};

const architectures = new Map([
  ['x86_64-pc-windows-msvc', 'x64'],
  ['aarch64-pc-windows-msvc', 'arm64'],
]);

const target = readArg('--target');
const rawBuild = Number(readArg('--build'));
const architecture = architectures.get(target);
if (architecture === undefined) {
  throw new Error(
    `MSIX is built only for ${[...architectures.keys()].join(', ')}`,
  );
}
if (!Number.isInteger(rawBuild) || rawBuild < 0 || rawBuild > 65535) {
  throw new Error(
    `The build number must be an integer from 0 to 65535, got ${rawBuild}`,
  );
}

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDir = dirname(dirname(packageDir));
const tauriDir = join(packageDir, 'src-tauri');
const releaseDir = join(
  repositoryDir,
  'packages',
  'server',
  'target',
  target,
  'release',
);

const { version: declared } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')));
const [major, minor] = declared.split(/[.-]/u);
const version = `${major}.${minor}.${rawBuild}.0`;

const assets = [
  'StoreLogo.png',
  'Square44x44Logo.png',
  'Square150x150Logo.png',
];
const resources = ['license.md', 'thirdPartyNotices.md', 'trademark.md'];

const msixDir = join(releaseDir, 'msix');
const stageDir = join(msixDir, 'stage');
rmSync(msixDir, { force: true, recursive: true });
mkdirSync(join(stageDir, 'Assets'), { recursive: true });

copyFileSync(
  join(releaseDir, 'musetric-app.exe'),
  join(stageDir, 'Musetric.exe'),
);
for (const name of resources) {
  copyFileSync(join(repositoryDir, name), join(stageDir, name));
}
for (const name of assets) {
  copyFileSync(
    join(tauriDir, 'gen-assets', name),
    join(stageDir, 'Assets', name),
  );
}
const unplatedDir = join(tauriDir, 'gen-assets', 'msix');
for (const name of readdirSync(unplatedDir)) {
  copyFileSync(join(unplatedDir, name), join(stageDir, 'Assets', name));
}
writeFileSync(
  join(stageDir, 'AppxManifest.xml'),
  readFileSync(join(tauriDir, 'windows', 'AppxManifest.xml'), 'utf8')
    .replaceAll('{{version}}', version)
    .replaceAll('{{architecture}}', architecture),
);

const kitsDir = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
const sdk = existsSync(kitsDir)
  ? readdirSync(kitsDir)
      .filter(
        (name) =>
          /^10\.\d+\.\d+\.\d+$/u.test(name) &&
          existsSync(join(kitsDir, name, 'x64', 'makeappx.exe')),
      )
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
      .at(-1)
  : undefined;
if (sdk === undefined) {
  throw new Error(`No makeappx.exe of the Windows SDK under ${kitsDir}`);
}

const priConfig = join(msixDir, 'priconfig.xml');
execFileSync(
  join(kitsDir, sdk, 'x64', 'makepri.exe'),
  ['createconfig', '/cf', priConfig, '/dq', 'en-US', '/pv', '10.0.0', '/o'],
  { stdio: 'inherit' },
);
execFileSync(
  join(kitsDir, sdk, 'x64', 'makepri.exe'),
  [
    'new',
    '/pr',
    stageDir,
    '/cf',
    priConfig,
    '/mn',
    join(stageDir, 'AppxManifest.xml'),
    '/of',
    join(stageDir, 'resources.pri'),
    '/o',
  ],
  { stdio: 'inherit' },
);

const output = join(msixDir, `Musetric_${version}_${architecture}.msix`);
execFileSync(
  join(kitsDir, sdk, 'x64', 'makeappx.exe'),
  ['pack', '/d', stageDir, '/p', output, '/o'],
  { stdio: 'inherit' },
);
console.log(output);
