import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv } from 'node:process';

if (argv.length < 4) {
  throw new Error(
    'Usage: assembleUpdateRelease.ts <artifacts-dir> <release-dir>',
  );
}

const [, , artifactsDir, releaseDir] = argv;

type Build = {
  platform: string;
  arch: string;
  installerExtension: string;
};

const builds: Build[] = [
  { platform: 'Windows', arch: 'x64', installerExtension: '.exe' },
  { platform: 'Windows', arch: 'arm64', installerExtension: '.exe' },
  { platform: 'macOS', arch: 'x64', installerExtension: '.dmg' },
  { platform: 'macOS', arch: 'arm64', installerExtension: '.dmg' },
  { platform: 'Linux', arch: 'x64', installerExtension: '.AppImage' },
  { platform: 'Linux', arch: 'arm64', installerExtension: '.AppImage' },
];

const getArtifactDir = (kind: string, build: Build): string =>
  join(artifactsDir, `musetric-${kind}-${build.platform}-${build.arch}`);

const getSingleFile = async (
  dir: string,
  predicate: (name: string) => boolean,
  description: string,
): Promise<string> => {
  const matches = (await readdir(dir)).filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `${description} in ${dir}: expected one file, found ${matches.length}`,
    );
  }
  return matches[0];
};

const copyFile = async (sourceDir: string, name: string): Promise<void> => {
  await cp(join(sourceDir, name), join(releaseDir, name));
};

const readManifest = async (dir: string, name: string): Promise<string> =>
  readFile(join(dir, name), 'utf8');

type UpdateInfoSections = {
  beforeFiles: string;
  files: string;
  afterFiles: string;
};

const splitManifest = (manifest: string): UpdateInfoSections => {
  const normalizedManifest = manifest.replaceAll('\r\n', '\n');
  const filesStart = normalizedManifest.indexOf('files:\n');
  const pathStart = normalizedManifest.indexOf('\npath:', filesStart);

  if (filesStart === -1 || pathStart === -1) {
    throw new Error('Unexpected electron-builder update manifest format');
  }

  return {
    beforeFiles: normalizedManifest.slice(0, filesStart),
    files: normalizedManifest
      .slice(filesStart + 'files:\n'.length, pathStart)
      .trimEnd(),
    afterFiles: normalizedManifest.slice(pathStart + 1),
  };
};

const getVersion = (manifest: string): string => {
  const version = /^version: (.+)$/m.exec(manifest)?.[1];
  if (version === undefined) {
    throw new Error('Update manifest has no version');
  }
  return version;
};

const mergeManifests = (manifests: string[]): string => {
  if (manifests.length === 0) {
    throw new Error('No update manifests to merge');
  }

  const [firstManifest] = manifests;

  const version = getVersion(firstManifest);
  for (const manifest of manifests.slice(1)) {
    if (getVersion(manifest) !== version) {
      throw new Error('Update manifests have different versions');
    }
  }

  const first = splitManifest(firstManifest);
  const sections = manifests.map(splitManifest);
  const files = sections.map((section) => section.files);
  return `${first.beforeFiles}files:\n${files.join('\n')}\n${first.afterFiles}`;
};

const copyUpdaterFiles = async (build: Build): Promise<void> => {
  const updaterDir = getArtifactDir('updater', build);
  const names = await readdir(updaterDir);

  for (const name of names) {
    const isBlockmap =
      build.platform === 'macOS'
        ? name.endsWith('.zip.blockmap')
        : name.endsWith(`${build.installerExtension}.blockmap`);
    const isMacZip = build.platform === 'macOS' && name.endsWith('.zip');
    const isLinuxManifest =
      build.platform === 'Linux' && name.startsWith('latest-linux');

    if (isBlockmap || isMacZip || isLinuxManifest) {
      await copyFile(updaterDir, name);
    }
  }
};

await rm(releaseDir, { force: true, recursive: true });
await mkdir(releaseDir, { recursive: true });

for (const build of builds) {
  const installerDir = getArtifactDir('desktop', build);
  const installer = await getSingleFile(
    installerDir,
    (name) => name.endsWith(build.installerExtension),
    `${build.platform} ${build.arch} installer`,
  );
  await copyFile(installerDir, installer);
  await copyUpdaterFiles(build);
}

const windows = builds.filter((build) => build.platform === 'Windows');
const mac = builds.filter((build) => build.platform === 'macOS');

const windowsManifests = await Promise.all(
  windows.map(async (build) =>
    readManifest(getArtifactDir('updater', build), 'latest.yml'),
  ),
);
const macManifests = await Promise.all(
  mac.map(async (build) =>
    readManifest(getArtifactDir('updater', build), 'latest-mac.yml'),
  ),
);

await writeFile(
  join(releaseDir, 'latest.yml'),
  mergeManifests(windowsManifests),
);
await writeFile(
  join(releaseDir, 'latest-mac.yml'),
  mergeManifests(macManifests),
);
