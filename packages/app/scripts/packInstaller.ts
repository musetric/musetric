import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
};

const target = readArg('--target');
const version = readArg('--version');
const config: {
  version?: string;
  bundle?: { createUpdaterArtifacts: boolean };
} = {};

if (version !== undefined) {
  config.version = version;
}
if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  config.bundle = { createUpdaterArtifacts: true };
}

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tauri = createRequire(import.meta.url).resolve(
  '@tauri-apps/cli/tauri.js',
);
const args = [tauri, 'build'];
if (target !== undefined) {
  args.push('--target', target);
}
if (Object.keys(config).length > 0) {
  args.push('--config', JSON.stringify(config));
}

execFileSync(process.execPath, args, { cwd: packageDir, stdio: 'inherit' });
