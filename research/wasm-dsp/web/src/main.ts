const RUNS = 5;
const results: Record<string, unknown>[] = [];
const log = (line: Record<string, unknown>) => {
  results.push(line);
  console.log(JSON.stringify(line));
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = async <T>(run: () => Promise<T>) => {
  let kept = await run();
  const times: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const start = performance.now();
    kept = await run();
    times.push(performance.now() - start);
  }
  return { ms: median(times), kept };
};
const realtime = (ms: number, audio: number) => Number(((audio * 1000) / ms).toFixed(1));
const fetchBytes = async (path: string) => new Uint8Array(await (await fetch(path)).arrayBuffer());

const runWorker = (mode: string) =>
  new Promise<void>((resolve) => {
    const worker = new Worker(`/dist/worker.js?mode=${mode}`, { type: 'module' });
    worker.onmessage = (event) => {
      if (event.data.done) {
        worker.terminate();
        resolve();
      } else {
        log(event.data.line);
      }
    };
    worker.onerror = (event) => {
      log({ side: mode, error: event.message });
      resolve();
    };
  });

const runMain = async () => {
  const files = [
    ['mp3-44k', 'song-44k.mp3', 44_100],
    ['aac-48k', 'song-48k.m4a', 48_000],
    ['flac-48k', 'song-48k.flac', 48_000],
    ['wav-48k', 'song-48k.wav', 48_000],
    ['vorbis-48k', 'song-48k.ogg', 48_000],
    ['opus-48k', 'song-48k.opus', 48_000],
  ] as const;
  for (const [name, file, rate] of files) {
    const bytes = await fetchBytes(`/data/${file}`);
    try {
      const { ms, kept } = await measure(() => new OfflineAudioContext(2, 1, rate).decodeAudioData(bytes.slice().buffer));
      log({ side: 'decodeAudioData', task: 'decode', case: name, ms, realtime: realtime(ms, kept.duration), frames: kept.length });
    } catch (failure) {
      log({ side: 'decodeAudioData', task: 'decode', case: name, error: String(failure) });
    }
  }
  const pcm = new Float32Array((await fetchBytes('/results/pcm-48k.f32')).buffer);
  const frames = pcm.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    left[frame] = pcm[frame * 2];
    right[frame] = pcm[frame * 2 + 1];
  }
  const outFrames = Math.round((frames * 44_100) / 48_000);
  const { ms } = await measure(async () => {
    const context = new OfflineAudioContext(2, outFrames, 44_100);
    const buffer = context.createBuffer(2, frames, 48_000);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return await context.startRendering();
  });
  log({ side: 'offline-audio-context', task: 'resample', case: '48k-to-44k', ms, realtime: realtime(ms, frames / 48_000) });
};

(async () => {
  const modes = (new URL(location.href).searchParams.get('modes') ?? 'rust-scalar,rust-simd,js,mp3,flac,aac,main').split(',');
  log({ side: 'env', userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, crossOriginIsolated });
  for (const mode of modes) {
    if (mode === 'main') {
      await runMain();
    } else {
      await runWorker(mode);
    }
  }
  (window as any).results = results;
  (window as any).done = true;
})();
