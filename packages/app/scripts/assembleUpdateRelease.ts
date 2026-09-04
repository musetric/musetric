import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
];

const isBinary = (name: string, ext: string): boolean =>
  name.endsWith(ext) && !name.endsWith(`${ext}.sig`);

type Entry = {
  signature: string;
  url: string;
};

const platforms: Record<string, Entry> = {};

await rm(releaseDir, { force: true, recursive: true });
await mkdir(releaseDir, { recursive: true });

for (const target of targets) {
  const artifact = join(
    artifactsDir,
    `musetric-desktop-${target.os}-${target.cpu}`,
  );
  const names = await readdir(artifact);
  const installerNames = names.filter((name) =>
    isBinary(name, target.installer),
  );
  if (installerNames.length !== 1) {
    throw new Error(
      `${target.os} ${target.cpu} installer in ${artifact}: expected one file, found ${installerNames.length}`,
    );
  }
  const [installerName] = installerNames;
  await cp(join(artifact, installerName), join(releaseDir, installerName));

  const updaterName = names.find((name) => isBinary(name, target.updater));
  const signatureName = names.find((name) =>
    name.endsWith(`${target.updater}.sig`),
  );
  if (updaterName === undefined || signatureName === undefined) {
    continue;
  }
  if (updaterName !== installerName) {
    await cp(join(artifact, updaterName), join(releaseDir, updaterName));
  }
  await cp(join(artifact, signatureName), join(releaseDir, signatureName));
  platforms[target.tauri] = {
    signature: (await readFile(join(artifact, signatureName), 'utf8')).trim(),
    url: `https://github.com/musetric/musetric/releases/download/v${version}/${updaterName}`,
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
