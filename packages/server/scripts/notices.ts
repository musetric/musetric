import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const builds = [
  {
    manifest: '../app/src-tauri/Cargo.toml',
    targets: [],
    output: '../app/notices/crates.md',
  },
  {
    manifest: '../dsp/Cargo.toml',
    targets: ['--target', 'wasm32-unknown-unknown'],
    output: '../dsp/notices/crates.md',
  },
];

for (const build of builds) {
  const text = execFileSync(
    'cargo',
    [
      'about',
      'generate',
      '--locked',
      '--fail',
      '--manifest-path',
      build.manifest,
      ...build.targets,
      'about.hbs',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  writeFileSync(build.output, `${text.replace(/\r\n?/g, '\n').trimEnd()}\n`);
}
