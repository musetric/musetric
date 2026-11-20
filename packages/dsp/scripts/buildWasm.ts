import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(packageDirectory, '..', 'server');
const output = join(packageDirectory, 'dist');
const target = 'wasm32-unknown-unknown';

const lockedVersion = (name: string): string => {
  const lock = readFileSync(join(workspace, 'Cargo.lock'), 'utf8');
  const found = new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock);
  if (!found) {
    throw new Error(`${name} is not in packages/server/Cargo.lock`);
  }
  return found[1];
};

const bindgen = lockedVersion('wasm-bindgen');
const installed = execFileSync('wasm-bindgen', ['--version'], {
  encoding: 'utf8',
}).trim();
if (installed !== `wasm-bindgen ${bindgen}`) {
  throw new Error(
    `Found ${installed}, need ${bindgen}: cargo install wasm-bindgen-cli --version ${bindgen} --locked`,
  );
}

const modules = [
  { name: 'capture', features: ['web-capture'] },
  { name: 'decode', features: ['web-decode'] },
  { name: 'songs', features: ['opus', 'songs', 'web-decode'] },
  { name: 'stretch', features: ['web-stretch'] },
];

const requested = process.argv.slice(2);
const unknown = requested.filter(
  (name) => !modules.some((module) => module.name === name),
);
if (unknown.length > 0) {
  throw new Error(`@musetric/dsp has no module ${unknown.join(', ')}`);
}
const built =
  requested.length === 0
    ? modules
    : modules.filter((module) => requested.includes(module.name));

rmSync(output, { recursive: true, force: true });
for (const { name, features } of built) {
  execFileSync(
    'cargo',
    [
      'rustc',
      '--release',
      '--locked',
      '--package',
      'musetric-dsp',
      '--lib',
      '--target',
      target,
      '--crate-type',
      'cdylib',
      '--no-default-features',
      '--features',
      features.join(','),
    ],
    { cwd: workspace, stdio: 'inherit' },
  );
  execFileSync(
    'wasm-bindgen',
    [
      '--target',
      'web',
      '--out-dir',
      output,
      '--out-name',
      name,
      join(workspace, 'target', target, 'release', 'musetric_dsp.wasm'),
    ],
    { stdio: 'inherit' },
  );
}
