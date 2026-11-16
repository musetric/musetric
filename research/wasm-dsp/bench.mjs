import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const work = resolve(process.env.WASM_DSP_WORK ?? join(repo, '../tmp/wasm-dsp'));
const windows = process.platform === 'win32';
const wasmFile = 'wasm32-unknown-unknown/release/musetric_wasm_dsp.wasm';
const features = ['decode', 'resample', 'encode', 'stretch'];
const allModes = 'rust-scalar,rust-simd,js,mp3,flac,aac,main,playback,stretch-cross';

const run = (command, args, options = {}) => {
  const result = command.endsWith('.cmd')
    ? spawnSync([command, ...args].join(' '), { stdio: 'inherit', shell: true, ...options })
    : spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result;
};

const cargo = (targetDir, args, rustflags) =>
  run('cargo', ['build', '--release', '--manifest-path', join(here, 'core/Cargo.toml'), '--target-dir', join(work, 'target', targetDir), ...args], {
    env: { ...process.env, RUSTFLAGS: rustflags ?? '' },
  });

const inputs = (song) => {
  if (!song) {
    throw new Error('inputs takes the path of the source song');
  }
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  const data = join(work, 'data');
  mkdirSync(data, { recursive: true });
  const to48k = ['-af', 'aresample=48000:filter_size=64:phase_shift=10:cutoff=0.97'];
  const make = (args, name) => run(ffmpeg, ['-v', 'error', '-y', '-i', song, '-map', '0:a', ...args, join(data, name)]);
  copyFileSync(song, join(data, 'song-44k.mp3'));
  make(['-c:a', 'flac', '-sample_fmt', 's16'], 'song-44k.flac');
  make([...to48k, '-c:a', 'pcm_s16le'], 'song-48k.wav');
  make([...to48k, '-c:a', 'flac', '-sample_fmt', 's16'], 'song-48k.flac');
  make([...to48k, '-c:a', 'aac', '-b:a', '192k'], 'song-48k.m4a');
  make([...to48k, '-c:a', 'libvorbis', '-q:a', '6'], 'song-48k.ogg');
  make([...to48k, '-c:a', 'libopus', '-b:a', '128k'], 'song-48k.opus');
  make([...to48k, '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'], 'stem-48k-24.flac');
  run(ffmpeg, ['-v', 'error', '-y', '-i', join(data, 'stem-48k-24.flac'), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', join(data, 'stem-48k-fmp4.mp4')]);
};

const build = async () => {
  cargo('native', ['--bins']);
  cargo('wasm-scalar', ['--lib', '--target', 'wasm32-unknown-unknown']);
  cargo('wasm-simd', ['--lib', '--target', 'wasm32-unknown-unknown'], '-C target-feature=+simd128');
  for (const feature of features) {
    cargo(`wasm-${feature}`, ['--lib', '--target', 'wasm32-unknown-unknown', '--no-default-features', '--features', feature], '-C target-feature=+simd128');
  }
  const web = join(work, 'web');
  mkdirSync(web, { recursive: true });
  copyFileSync(join(here, 'web/package.json'), join(web, 'package.json'));
  copyFileSync(join(here, 'web/package-lock.json'), join(web, 'package-lock.json'));
  run(windows ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: web });
  const esbuild = createRequire(join(web, 'package.json'))('esbuild');
  await esbuild.build({
    entryPoints: [join(here, 'web/src/main.ts'), join(here, 'web/src/worker.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outdir: join(web, 'dist'),
    nodePaths: [join(web, 'node_modules')],
    alias: { '@musetric/utils': join(repo, 'packages/utils/src/index.ts') },
    logLevel: 'warning',
  });
};

const native = () => {
  const bin = (name) => join(work, 'target/native/release', windows ? `${name}.exe` : name);
  mkdirSync(join(work, 'results'), { recursive: true });
  for (const [name, out] of [['bench', 'native.jsonl'], ['playback', 'native-playback.jsonl']]) {
    const result = run(bin(name), [], { stdio: ['ignore', 'pipe', 'inherit'] });
    writeFileSync(join(work, 'results', out), result.stdout);
    process.stdout.write(result.stdout);
  }
};

const serve = () => {
  const routes = { '/': join(here, 'web/index.html'), '/wasm/scalar.wasm': join(work, 'target/wasm-scalar', wasmFile), '/wasm/simd.wasm': join(work, 'target/wasm-simd', wasmFile) };
  const prefixes = [['/data/', join(work, 'data')], ['/results/', join(work, 'results')], ['/node_modules/', join(work, 'web/node_modules')], ['/dist/', join(work, 'web/dist')]];
  const types = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const prefix = prefixes.find(([start]) => path.startsWith(start));
    const file = routes[path] ?? (prefix ? join(prefix[1], decodeURIComponent(path.slice(prefix[0].length))) : undefined);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(0, () => done(server)));
};

const browser = async (modes = allModes) => {
  const server = await serve();
  const { chromium } = createRequire(join(work, 'web/package.json'))('playwright');
  const chrome = await chromium.launch({ headless: true, channel: 'chrome', args: ['--force_high_performance_gpu'] });
  const page = await chrome.newPage();
  page.on('console', (message) => {
    if (message.text().startsWith('{')) {
      console.log(message.text());
    }
  });
  page.on('pageerror', (failure) => console.log('pageerror', failure.message));
  await page.goto(`http://localhost:${server.address().port}/?modes=${modes}`);
  await page.waitForFunction(() => window.done === true, null, { timeout: 1_800_000, polling: 1000 });
  const results = await page.evaluate(() => window.results);
  writeFileSync(join(work, 'results', `web-${modes.replaceAll(',', '_')}.jsonl`), `${results.map((line) => JSON.stringify(line)).join('\n')}\n`);
  await chrome.close();
  server.close();
};

const sizes = () => {
  const files = {
    ...Object.fromEntries([['all, scalar', 'wasm-scalar'], ['all, simd', 'wasm-simd'], ...features.map((feature) => [`${feature}, simd`, `wasm-${feature}`])].map(([name, dir]) => [`rust ${name}`, join(work, 'target', dir, wasmFile)])),
    'signalsmith-stretch': join(work, 'web/node_modules/signalsmith-stretch/SignalsmithStretch.mjs'),
    'libsamplerate-js': join(work, 'web/node_modules/@alexanderolsen/libsamplerate-js/dist/libsamplerate.js'),
    'mediabunny mp3 encoder (LAME)': join(work, 'web/node_modules/@mediabunny/mp3-encoder/dist/bundles/mediabunny-mp3-encoder.min.mjs'),
    'mediabunny flac encoder (libFLAC)': join(work, 'web/node_modules/@mediabunny/flac-encoder/dist/bundles/mediabunny-flac-encoder.min.mjs'),
    'mediabunny aac encoder (libavcodec)': join(work, 'web/node_modules/@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.min.mjs'),
    'mediabunny core': join(work, 'web/node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'),
  };
  const lines = Object.entries(files).map(([name, path]) => {
    const bytes = readFileSync(path);
    const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    return JSON.stringify({ name, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli });
  });
  writeFileSync(join(work, 'results', 'sizes.jsonl'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
};

const drift = async () => {
  const floats = (path) => {
    const bytes = readFileSync(path);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  };
  const { instance } = await WebAssembly.instantiate(readFileSync(join(work, 'target/wasm-simd', wasmFile)), {});
  const e = instance.exports;
  const pcm = floats(join(work, 'results/pcm-44k.f32'));
  const pointer = e.alloc(pcm.length * 4);
  new Float32Array(e.memory.buffer, pointer, pcm.length).set(pcm);
  e.stretch(pointer, pcm.length, 44_100, 2, 100, 0);
  const wasm = new Float32Array(e.memory.buffer, e.floats_ptr(), e.floats_len()).slice();
  const native = floats(join(work, 'results/native/stretch-pitch+2.f32'));
  const lines = [0.05, 0.5, 1, 2, 5, 10, 30, 60, 120].map((seconds) => {
    const start = Math.round(seconds * 44_100) * 2;
    let signal = 0;
    let noise = 0;
    for (let index = start; index < start + 4410; index += 1) {
      signal += native[index] ** 2;
      noise += (native[index] - wasm[index]) ** 2;
    }
    return JSON.stringify({ task: 'stretch-drift', case: 'pitch+2 wasm against native, 50 ms window', seconds, snrDb: noise === 0 ? 'identical' : Number((10 * Math.log10(signal / noise)).toFixed(1)) });
  });
  writeFileSync(join(work, 'results', 'drift.jsonl'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
};

const [command, argument] = process.argv.slice(2);
const commands = {
  inputs: () => inputs(argument),
  build,
  native,
  web: () => browser(argument),
  sizes,
  drift,
  all: async () => {
    await build();
    native();
    await browser();
    sizes();
    await drift();
  },
};
if (!commands[command]) {
  console.log('node bench.mjs inputs <song> | build | native | web [modes] | sizes | drift | all');
  process.exit(1);
}
await commands[command]();
