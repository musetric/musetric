import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tarBin =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';

const releaseRepo = 'https://github.com/musetric/ffmpeg-builds';
const releaseTag = 'ffmpeg-n8.1.2';
const releaseBase = `${releaseRepo}/releases/download/${releaseTag}`;

type FfmpegBuild = {
  url: string;
  sha256: string;
  exe: '' | '.exe';
  ffmpegSha256: string;
};

type FfmpegHashes = {
  archive: string;
  ffmpeg: string;
};

const musetric = (
  os: 'windows' | 'linux' | 'macos',
  arch: 'x64' | 'arm64',
  hashes: FfmpegHashes,
): FfmpegBuild => ({
  url: `${releaseBase}/ffmpeg-lgpl-${os}-${arch}.tar.gz`,
  sha256: hashes.archive,
  exe: os === 'windows' ? '.exe' : '',
  ffmpegSha256: hashes.ffmpeg,
});

const builds = new Map<string, FfmpegBuild>([
  [
    'win32-x64',
    musetric('windows', 'x64', {
      archive:
        '655229847a3f2c2f51d360ddf82c06cf759de861431e6aca2776deacc20928ed',
      ffmpeg:
        '22c517bb3a005ee56139d290631a4199ddd223dd230c05427177ac7fbba177c6',
    }),
  ],
  [
    'win32-arm64',
    musetric('windows', 'arm64', {
      archive:
        '11c870008366aa7ae0c26e148873c1563faefe7af949a7962d4cef790449873c',
      ffmpeg:
        '5a8ece55b2b8521e07c57d131ce6db1301c13c5380105dc1873271fdfea8eb01',
    }),
  ],
  [
    'linux-x64',
    musetric('linux', 'x64', {
      archive:
        'ac2c24beae8ba279f59a6161aa9786b52f23c8bb092955b4b522b39e337a4a07',
      ffmpeg:
        '73dd2b464b68fae0bda391a9295c23b60a00f7e71a5355d767ccc025980423a1',
    }),
  ],
  [
    'linux-arm64',
    musetric('linux', 'arm64', {
      archive:
        'dac20991bca0b5bf5fcaceb95bbcf7b70db97b6585717a88f3bd0ce55c44e42c',
      ffmpeg:
        '5de68cea92a24ef39da5fec2f6a5eb4936e9529118c8f26cff469c57f46dbbab',
    }),
  ],
  [
    'darwin-arm64',
    musetric('macos', 'arm64', {
      archive:
        'e25393de3bedc64367f20acf792d484d6ccb747b07b9510be4fa834d613289a6',
      ffmpeg:
        'b4527d8e038abb7539a71d89dc9e7e56015713f5ac4b16afd289bc7470cf8956',
    }),
  ],
  [
    'darwin-x64',
    musetric('macos', 'x64', {
      archive:
        '3d44ecbae9fb6e8e8f4e563be62336cfc42d328364e8db54dedff737b85bc9d7',
      ffmpeg:
        '0bdf967aad6086c534bcc4a4f1e208a5c9160fbf8fcb27141ce4e05ecc59cd3b',
    }),
  ],
]);

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const resourcesDir = join(packageDir, 'resources');

const cacheHome =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
    : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'));
const storeRoot = join(cacheHome, 'musetric', 'ffmpeg', releaseTag);

const args = process.argv.slice(2);
const force = args.includes('--force');
const prune = args.includes('--prune');
const explicitKeys = args.filter((arg) => !arg.startsWith('--'));
const hostKey = `${process.platform}-${process.arch}`;

const licenseName = 'LICENSE.txt';
const sourceName = 'source.txt';
const licenseSha256 =
  '246041b6ecf9bc32d718a62c57877c78b5eb397b6467e74ed7ae2626ab189c30';
const downloadTimeoutMs = 5 * 60 * 1000;

const members = (build: FfmpegBuild): string[] => [
  `ffmpeg${build.exe}`,
  licenseName,
];

const sourceNote = (build: FfmpegBuild): string =>
  [
    `release: ${releaseRepo}/releases/tag/${releaseTag}`,
    `archive: ${build.url}`,
    `sha256: ${build.sha256}`,
    `source: ${releaseRepo} holds the ffmpeg sources and build scripts for ${releaseTag}`,
    '',
  ].join('\n');

const sha256Of = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

const memberSha256 = (build: FfmpegBuild, member: string): string =>
  member === `ffmpeg${build.exe}` ? build.ffmpegSha256 : licenseSha256;

const hasExpectedMembers = async (
  targetDir: string,
  build: FfmpegBuild,
): Promise<boolean> => {
  try {
    const actualHashes = await Promise.all(
      members(build).map(async (member) => sha256Of(join(targetDir, member))),
    );
    return actualHashes.every(
      (actual, index) => actual === memberSha256(build, members(build)[index]),
    );
  } catch {
    return false;
  }
};

const download = async (
  build: FfmpegBuild,
  destPath: string,
): Promise<void> => {
  console.log(`Downloading ${build.url}`);
  const response = await fetch(build.url, {
    signal: AbortSignal.timeout(downloadTimeoutMs),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${build.url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
  const actual = await sha256Of(destPath);
  if (actual !== build.sha256) {
    throw new Error(
      `Checksum mismatch for ${build.url}: expected ${build.sha256}, got ${actual}`,
    );
  }
};

const ensureStore = async (
  key: string,
  build: FfmpegBuild,
): Promise<string> => {
  const storeDir = join(storeRoot, key);
  if (await hasExpectedMembers(storeDir, build)) {
    return storeDir;
  }
  const downloadDir = await mkdtemp(join(tmpdir(), 'musetric-ffmpeg-'));
  const stageDir = `${storeDir}.stage`;
  try {
    const archivePath = join(downloadDir, `${key}.tar.gz`);
    await download(build, archivePath);
    await rm(stageDir, { recursive: true, force: true });
    await mkdir(stageDir, { recursive: true });
    await execFileAsync(tarBin, [
      '-xf',
      archivePath,
      '-C',
      stageDir,
      ...members(build),
    ]);
    await rm(storeDir, { recursive: true, force: true });
    await rename(stageDir, storeDir);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
    await rm(stageDir, { recursive: true, force: true });
  }
  return storeDir;
};

const strangers = async (
  targetDir: string,
  build: FfmpegBuild,
): Promise<string[]> => {
  const expected = new Set([...members(build), sourceName]);
  const entries = await readdir(targetDir);
  return entries.filter((entry) => !expected.has(entry));
};

const removeStrangers = async (
  targetDir: string,
  build: FfmpegBuild,
): Promise<void> => {
  for (const entry of await strangers(targetDir, build)) {
    await rm(join(targetDir, entry), { recursive: true, force: true });
  }
};

const isVendored = async (
  targetDir: string,
  build: FfmpegBuild,
): Promise<boolean> => {
  const sourcePath = join(targetDir, sourceName);
  if (!existsSync(sourcePath)) {
    return false;
  }
  if ((await readFile(sourcePath, 'utf8')) !== sourceNote(build)) {
    return false;
  }
  if ((await strangers(targetDir, build)).length > 0) {
    return false;
  }
  return hasExpectedMembers(targetDir, build);
};

const vendorKey = async (key: string): Promise<void> => {
  const build = builds.get(key);
  if (build === undefined) {
    throw new Error(
      `No pinned ffmpeg build for ${key}. ` +
        `Supported: ${[...builds.keys()].join(', ')}.`,
    );
  }
  const targetDir = join(resourcesDir, key);
  if (!force && (await isVendored(targetDir, build))) {
    console.log(`ffmpeg already vendored for ${key}, skipping.`);
    return;
  }
  const storeDir = await ensureStore(key, build);
  await mkdir(targetDir, { recursive: true });
  await removeStrangers(targetDir, build);
  for (const member of members(build)) {
    const destPath = join(targetDir, member);
    await copyFile(join(storeDir, member), destPath);
    if (build.exe === '' && member !== licenseName) {
      await chmod(destPath, 0o755);
    }
  }
  await writeFile(join(targetDir, sourceName), sourceNote(build));
  console.log(`Vendored ffmpeg for ${key}.`);
};

const pruneKeys = async (keys: string[]): Promise<void> => {
  const entries = await readdir(resourcesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || keys.includes(entry.name)) {
      continue;
    }
    await rm(join(resourcesDir, entry.name), { recursive: true, force: true });
    console.log(`Pruned vendored ffmpeg for ${entry.name}.`);
  }
};

const resolveKeys = (): string[] =>
  explicitKeys.length > 0 ? explicitKeys : [hostKey];

const main = async (): Promise<void> => {
  if (process.env.MUSETRIC_SKIP_FFMPEG_FETCH !== undefined) {
    console.log('Skipping ffmpeg fetch.');
    return;
  }
  const keys = resolveKeys();
  for (const key of keys) {
    await vendorKey(key);
  }
  if (prune) {
    await pruneKeys(keys);
  }
};

await main();
