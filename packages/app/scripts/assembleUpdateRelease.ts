import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { argv } from 'node:process';

if (argv.length < 5) {
  throw new Error(
    'Usage: assembleUpdateRelease.ts <artifacts-dir> <release-dir> <version>',
  );
}

const [, , artifactsDir, releaseDir, version] = argv;

type Target = {
  os: string;
  cpu: string;
  tauri: string;
  installer: string;
  updater: string;
  updaterArtifact?: string;
};

const targets: Target[] = [
  {
    os: 'Windows',
    cpu: 'x64',
    tauri: 'windows-x86_64',
    installer: '.exe',
    updater: '.exe',
  },
  {
    os: 'Windows',
    cpu: 'arm64',
    tauri: 'windows-aarch64',
    installer: '.exe',
    updater: '.exe',
  },
  {
    os: 'macOS',
    cpu: 'x64',
    tauri: 'darwin-x86_64',
    installer: '.dmg',
    updater: '.app.tar.gz',
  },
  {
    os: 'macOS',
    cpu: 'arm64',
    tauri: 'darwin-aarch64',
    installer: '.dmg',
    updater: '.app.tar.gz',
  },
  {
    os: 'Linux',
    cpu: 'x64',
    tauri: 'linux-x86_64',
    installer: '.deb',
    updater: '.AppImage',
    updaterArtifact: 'appimage',
  },
  {
    os: 'Linux',
    cpu: 'arm64',
    tauri: 'linux-aarch64',
    installer: '.deb',
    updater: '.AppImage',
    updaterArtifact: 'appimage',
  },
];

const isBinary = (name: string, ext: string): boolean =>
  name.endsWith(ext) && !name.endsWith(`${ext}.sig`);

const artifactDir = (target: Target, kind: 'installer' | 'updater'): string => {
  const suffix =
    kind === 'updater' && target.updaterArtifact !== undefined
      ? target.updaterArtifact
      : 'installer';
  return join(
    artifactsDir,
    `musetric-desktop-${target.os}-${target.cpu}-${suffix}`,
  );
};

const collectFiles = async (dir: string, ext: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isBinary(entry.name, ext))
    .map((entry) => join(entry.parentPath, entry.name).split(sep).join('/'));
};

type Entry = {
  signature: string;
  url: string;
};

const platforms: Record<string, Entry> = {};

await rm(releaseDir, { force: true, recursive: true });
await mkdir(releaseDir, { recursive: true });

for (const target of targets) {
  const installerArtifact = artifactDir(target, 'installer');
  const updaterArtifact = artifactDir(target, 'updater');
  const installerNames = await collectFiles(
    installerArtifact,
    target.installer,
  );
  if (installerNames.length !== 1) {
    throw new Error(
      `${target.os} ${target.cpu} installer in ${installerArtifact}: expected one file, found ${installerNames.length}`,
    );
  }
  const [installerName] = installerNames;
  const installerBase = installerName.slice(installerName.lastIndexOf('/') + 1);
  await cp(installerName, join(releaseDir, installerBase));

  const updaterCandidates = await collectFiles(updaterArtifact, target.updater);
  const updaterName =
    updaterCandidates.find((candidate) => candidate !== installerName) ??
    installerName;
  const updaterBase = updaterName.slice(updaterName.lastIndexOf('/') + 1);
  const signaturePath = `${updaterName}.sig`;
  const signatureContent = await readFile(signaturePath, 'utf8').catch(
    () => undefined,
  );
  if (signatureContent === undefined) {
    continue;
  }
  if (updaterBase !== installerBase) {
    await cp(updaterName, join(releaseDir, updaterBase));
  }
  const signatureBase = `${updaterBase}.sig`;
  await cp(signaturePath, join(releaseDir, signatureBase));
  platforms[target.tauri] = {
    signature: signatureContent.trim(),
    url: `https://github.com/musetric/musetric/releases/download/v${version}/${updaterBase}`,
  };
}

if (Object.keys(platforms).length > 0) {
  await writeFile(
    join(releaseDir, 'latest.json'),
    `${JSON.stringify(
      {
        version,
        notes: `Musetric ${version}`,
        pub_date: new Date().toISOString(),
        platforms,
      },
      undefined,
      2,
    )}\n`,
  );
}
