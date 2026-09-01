import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Platform = {
  target: string;
  genDir: string;
  marker: string;
  overlayDir: string;
  staleFiles: string[];
  projectFile?: string;
};

const platforms = new Map<string, Platform>([
  [
    'android',
    {
      target: 'android',
      genDir: 'android',
      marker: 'settings.gradle',
      overlayDir: 'android',
      staleFiles: [
        'app/src/main/res/drawable/ic_launcher_background.xml',
        'app/src/main/res/drawable-v24/ic_launcher_foreground.xml',
        'app/src/main/res/layout/activity_main.xml',
        'app/src/main/res/values-night/themes.xml',
      ],
    },
  ],
  [
    'ios',
    {
      target: 'ios',
      genDir: 'apple',
      marker: 'project.yml',
      overlayDir: 'apple',
      staleFiles: [],
      projectFile: 'musetric-mobile.xcodeproj',
    },
  ],
]);

const [, , rawPlatform] = process.argv;
const platform = platforms.get(rawPlatform);

if (!platform) {
  const names = [...platforms.keys()].join(', ');
  throw new Error(`Expected a platform argument: ${names}`);
}

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const genDir = join(packageDir, 'src-tauri', 'gen', platform.genDir);
const overlayDir = join(packageDir, 'native', platform.overlayDir);

if (!existsSync(join(genDir, platform.marker))) {
  const tauri = createRequire(import.meta.url).resolve(
    '@tauri-apps/cli/tauri.js',
  );
  execFileSync(process.execPath, [tauri, platform.target, 'init'], {
    cwd: packageDir,
    stdio: 'inherit',
  });
}

const substituteEnvPlaceholders = (content: string): string =>
  content.replaceAll('${DEVELOPMENT_TEAM}', process.env.DEVELOPMENT_TEAM ?? '');

const applyOverlay = (sourceDir: string, targetDir: string): boolean => {
  let changed = false;

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      changed = applyOverlay(source, target) || changed;
      continue;
    }

    const content = substituteEnvPlaceholders(readFileSync(source, 'utf8'));
    if (existsSync(target) && readFileSync(target, 'utf8') === content)
      continue;

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(target, content);
    changed = true;
  }

  return changed;
};

const overlayChanged = applyOverlay(overlayDir, genDir);

const staleRemoved = platform.staleFiles.filter((file) => {
  const path = join(genDir, file);
  if (!existsSync(path)) return false;

  rmSync(path);
  const parent = dirname(path);
  if (readdirSync(parent).length === 0) rmSync(parent, { recursive: true });

  return true;
});

if (platform.projectFile !== undefined) {
  const projectMissing = !existsSync(join(genDir, platform.projectFile));

  if (overlayChanged || staleRemoved.length > 0 || projectMissing) {
    execFileSync('xcodegen', ['generate'], { cwd: genDir, stdio: 'inherit' });
  }
}
