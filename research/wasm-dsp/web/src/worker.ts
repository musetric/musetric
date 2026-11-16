import { ConverterType, create } from '@alexanderolsen/libsamplerate-js';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { registerFlacEncoder } from '@mediabunny/flac-encoder';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { decodeMp4 } from '../../../../packages/audio/src/decoder/mp4/index.js';
import { createResampler } from '../../../../../landing/src/pages/landing/tryIt/resampler.cross.js';

const RUNS = 5;
const mode = new URL(self.location.href).searchParams.get('mode') ?? 'rust';
const post = (line: Record<string, unknown>) => self.postMessage({ line });

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const measure = async <T>(run: () => Promise<T> | T): Promise<{ ms: number; kept: T }> => {
  let kept = await run();
  const times: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const start = performance.now();
    kept = await run();
    times.push(performance.now() - start);
  }
  return { ms: median(times), kept };
};

const fetchBytes = async (path: string) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const fetchFloats = async (path: string) => new Float32Array((await fetchBytes(path)).buffer);

const compare = (reference: Float32Array, value: Float32Array) => {
  const length = Math.min(reference.length, value.length);
  let signal = 0;
  let noise = 0;
  let max = 0;
  for (let index = 0; index < length; index += 1) {
    const difference = reference[index] - value[index];
    signal += reference[index] * reference[index];
    noise += difference * difference;
    max = Math.max(max, Math.abs(difference));
  }
  const snr = noise === 0 ? 'inf' : (10 * Math.log10(signal / noise)).toFixed(1);
  return { lengthDiff: value.length - reference.length, maxAbs: Number(max.toExponential(2)), snrDb: snr };
};

const bestLag = (reference: Float32Array, value: Float32Array, range: number) => {
  const start = 44_100 * 2 * 30;
  const window = 44_100 * 2 * 5;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -range; lag <= range; lag += 1) {
    let score = 0;
    for (let index = start; index < start + window; index += 2) {
      score += reference[index] * (value[index + lag * 2] ?? 0);
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
};

const compareAligned = (reference: Float32Array, value: Float32Array) => {
  const lag = bestLag(reference, value, 64);
  const shifted = lag >= 0 ? value.subarray(lag * 2) : value;
  const base = lag >= 0 ? reference : reference.subarray(-lag * 2);
  return { lag, ...compare(base, shifted) };
};

const fftMagnitudes = (frame: Float32Array) => {
  const size = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(size);
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < length / 2; k += 1) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + length / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const out = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k += 1) out[k] = Math.hypot(re[k], im[k]);
  return out;
};

const spectralCompare = (reference: Float32Array, value: Float32Array) => {
  const size = 2048;
  const frames = Math.min(reference.length, value.length) / 2;
  const limit = Math.min(frames, 44_100 * 60);
  const frameOf = (source: Float32Array, start: number) => {
    const frame = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      frame[i] = source[(start + i) * 2] * hann;
    }
    return frame;
  };
  let signal = 0;
  let noise = 0;
  let logDistance = 0;
  let count = 0;
  for (let start = 0; start + size < limit; start += size / 2) {
    const a = fftMagnitudes(frameOf(reference, start));
    const b = fftMagnitudes(frameOf(value, start));
    let frameDistance = 0;
    for (let k = 0; k < a.length; k += 1) {
      signal += a[k] * a[k];
      noise += (a[k] - b[k]) ** 2;
      const da = 20 * Math.log10(a[k] + 1e-6);
      const db = 20 * Math.log10(b[k] + 1e-6);
      frameDistance += (da - db) ** 2;
    }
    logDistance += Math.sqrt(frameDistance / a.length);
    count += 1;
  }
  return { magnitudeSnrDb: Number((10 * Math.log10(signal / noise)).toFixed(1)), logSpectralDistanceDb: Number((logDistance / count).toFixed(2)) };
};

const sha = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);

type Rust = ReturnType<typeof wrapRust>;

const wrapRust = (instance: WebAssembly.Instance) => {
  const e = instance.exports as Record<string, any>;
  const memory = e.memory as WebAssembly.Memory;
  const putBytes = (bytes: Uint8Array) => {
    const pointer = e.alloc(bytes.length);
    new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
    return pointer;
  };
  const putFloats = (floats: Float32Array) => {
    const pointer = e.alloc(floats.length * 4);
    new Float32Array(memory.buffer, pointer, floats.length).set(floats);
    return pointer;
  };
  const check = (result: number) => {
    if (result < 0) {
      throw new Error(new TextDecoder().decode(new Uint8Array(memory.buffer, e.error_ptr(), e.error_len())));
    }
  };
  const takeFloats = () => {
    const out = new Float32Array(memory.buffer, e.floats_ptr(), e.floats_len()).slice();
    e.clear();
    return out;
  };
  const takeBytes = () => {
    const out = new Uint8Array(memory.buffer, e.bytes_ptr(), e.bytes_len()).slice();
    e.clear();
    return out;
  };
  const withFloats = (floats: Float32Array, call: (pointer: number) => number) => {
    const pointer = putFloats(floats);
    try {
      check(call(pointer));
    } finally {
      e.release(pointer, floats.length * 4);
    }
  };
  return {
    decode: (bytes: Uint8Array, extension: string) => {
      const name = new TextEncoder().encode(extension);
      const namePointer = putBytes(name);
      check(e.decode(putBytes(bytes), bytes.length, namePointer, name.length, 0));
      e.release(namePointer, name.length);
      return { pcm: takeFloats(), rate: e.source_rate() as number };
    },
    resample: (floats: Float32Array, input: number, output: number) => {
      withFloats(floats, (pointer) => e.resample(pointer, floats.length, input, output));
      return takeFloats();
    },
    encode: (floats: Float32Array, format: number, rate: number, bitrate: number) => {
      withFloats(floats, (pointer) => e.encode(pointer, floats.length, format, rate, bitrate));
      return takeBytes();
    },
    stretch: (floats: Float32Array, rate: number, semitones: number, tempo: number, formants: boolean) => {
      withFloats(floats, (pointer) => e.stretch(pointer, floats.length, rate, semitones, tempo, formants ? 1 : 0));
      return takeFloats();
    },
    pages: () => memory.buffer.byteLength,
  };
};

const files = [
  ['mp3-44k', 'song-44k.mp3', 'mp3'],
  ['aac-48k', 'song-48k.m4a', 'm4a'],
  ['flac-48k', 'song-48k.flac', 'flac'],
  ['wav-48k', 'song-48k.wav', 'wav'],
  ['vorbis-48k', 'song-48k.ogg', 'ogg'],
  ['opus-48k', 'song-48k.opus', 'opus'],
] as const;

const seconds = (pcm: Float32Array, rate: number) => pcm.length / 2 / rate;
const realtime = (ms: number, audio: number) => Number(((audio * 1000) / ms).toFixed(1));

const runRust = async (variant: string) => {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(`/wasm/${variant}.wasm`), {});
  const rust: Rust = wrapRust(instance);
  const side = `wasm-${variant}`;
  for (const [name, file, extension] of files) {
    const bytes = await fetchBytes(`/data/${file}`);
    try {
      const { ms, kept } = await measure(() => rust.decode(bytes, extension));
      const native = await fetchFloats(`/results/native/decode-${name}.f32`);
      post({ side, task: 'decode', case: name, ms, realtime: realtime(ms, seconds(kept.pcm, kept.rate)), vsNative: compare(native, kept.pcm) });
    } catch (failure) {
      post({ side, task: 'decode', case: name, error: String(failure) });
    }
  }
  const pcm48 = await fetchFloats('/results/pcm-48k.f32');
  const pcm44 = await fetchFloats('/results/pcm-44k.f32');
  const audio48 = seconds(pcm48, 48_000);
  const audio44 = seconds(pcm44, 44_100);
  {
    const { ms, kept } = await measure(() => rust.resample(pcm48, 48_000, 44_100));
    const native = await fetchFloats('/results/native/resample-48k-to-44k.f32');
    post({ side, task: 'resample', case: '48k-to-44k', ms, realtime: realtime(ms, audio48), vsNative: compare(native, kept) });
  }
  for (const [name, format] of [['flac-16', 0], ['aac-192', 1], ['mp3-192', 2]] as const) {
    const { ms, kept } = await measure(() => rust.encode(pcm44, format, 44_100, 192_000));
    const native = await fetchBytes(`/results/native/encode-${name}.bin`);
    post({ side, task: 'encode', case: name, ms, realtime: realtime(ms, audio44), bytes: kept.length, sameBytesAsNative: (await sha(kept)) === (await sha(native)) });
  }
  for (const [name, semitones, tempo, formants] of [['pitch+2', 2, 100, false], ['tempo80', 0, 80, false], ['pitch+2-formants', 2, 100, true]] as const) {
    const { ms, kept } = await measure(() => rust.stretch(pcm44, 44_100, semitones, tempo, formants));
    const native = await fetchFloats(`/results/native/stretch-${name}.f32`);
    post({ side, task: 'stretch', case: name, ms, realtime: realtime(ms, audio44), vsNative: compare(native, kept) });
  }
  post({ side, task: 'memory', case: 'peak-wasm-memory-mb', value: Math.round(rust.pages() / 2 ** 20) });
};

const interleave = (planes: Float32Array[]) => {
  const out = new Float32Array(planes[0].length * 2);
  for (let frame = 0; frame < planes[0].length; frame += 1) {
    out[frame * 2] = planes[0][frame];
    out[frame * 2 + 1] = planes[1 % planes.length][frame];
  }
  return out;
};

const planar = (interleaved: Float32Array) => {
  const frames = interleaved.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    left[frame] = interleaved[frame * 2];
    right[frame] = interleaved[frame * 2 + 1];
  }
  return [left, right];
};

const decodeMediabunny = async (bytes: Uint8Array) => {
  const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) {
    throw new Error('no audio track');
  }
  const sink = new AudioSampleSink(track);
  const left: Float32Array[] = [];
  const right: Float32Array[] = [];
  let rate = 0;
  for await (const sample of sink.samples()) {
    rate = sample.sampleRate;
    const frames = sample.numberOfFrames;
    const planes = Array.from({ length: Math.min(sample.numberOfChannels, 2) }, (_, plane) => {
      const samples = new Float32Array(frames);
      sample.copyTo(samples, { planeIndex: plane, format: 'f32-planar' });
      return samples;
    });
    left.push(planes[0]);
    right.push(planes[1] ?? planes[0]);
    sample.close();
  }
  input.dispose();
  const join = (parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  return { pcm: interleave([join(left), join(right)]), rate };
};

const resampleLanding = (pcm: Float32Array, input: number, output: number) => {
  const parts: Float32Array[] = [];
  const resampler = createResampler({ sourceRate: input, targetRate: output, channels: 2, emit: (chunk) => parts.push(chunk) });
  const [left, right] = planar(pcm);
  const block = 8192;
  for (let start = 0; start < left.length; start += block) {
    resampler.push([left.subarray(start, start + block), right.subarray(start, start + block)]);
  }
  resampler.finish();
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const resampleLibsamplerate = async (pcm: Float32Array, input: number, output: number, converterType: number) => {
  const planes = planar(pcm);
  const out: Float32Array[] = [];
  for (const plane of planes) {
    const src = await create(1, input, output, { converterType });
    try {
      out.push(src.simple(plane) as Float32Array);
    } finally {
      src.destroy();
    }
  }
  return interleave(out);
};

const encodeMediabunny = async (pcm: Float32Array, codec: 'mp3' | 'flac' | 'aac') => {
  const format = codec === 'mp3' ? new Mp3OutputFormat() : codec === 'flac' ? new FlacOutputFormat() : new Mp4OutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new AudioSampleSource(codec === 'flac' ? { codec } : { codec, bitrate: 192_000 });
  output.addAudioTrack(source);
  await output.start();
  const block = 65_536;
  for (let start = 0; start < pcm.length; start += block * 2) {
    const data = pcm.slice(start, start + block * 2);
    await source.add(new AudioSample({ data, format: 'f32', numberOfChannels: 2, sampleRate: 44_100, timestamp: start / 2 / 44_100 }));
  }
  source.close();
  await output.finalize();
  return new Uint8Array(target.buffer!);
};

const encodeWebCodecs = async (pcm: Float32Array, codec: string, bitrate: number) => {
  const config = { codec, sampleRate: 44_100, numberOfChannels: 2, bitrate };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`${codec} is not supported`);
  }
  let bytes = 0;
  const encoder = new AudioEncoder({ output: (chunk) => (bytes += chunk.byteLength), error: (failure) => { throw failure; } });
  encoder.configure(config);
  const block = 4096;
  for (let start = 0; start < pcm.length; start += block * 2) {
    const data = pcm.slice(start, start + block * 2);
    encoder.encode(new AudioData({ format: 'f32', sampleRate: 44_100, numberOfChannels: 2, numberOfFrames: data.length / 2, timestamp: Math.round((start / 2 / 44_100) * 1e6), data }));
  }
  await encoder.flush();
  encoder.close();
  return bytes;
};

const loadSignalsmith = async () => {
  const source = await (await fetch('/node_modules/signalsmith-stretch/SignalsmithStretch.mjs')).text();
  const moduleSource = source.slice(0, source.indexOf('function registerWorkletProcessor'));
  const factory = new Function(`${moduleSource}; return SignalsmithStretch;`)();
  return await factory();
};

const stretchSignalsmith = (module: any, pcm: Float32Array, semitones: number, tempo: number) => {
  const rate = 44_100;
  const block = 4096;
  const outBlock = Math.round((block * 100) / tempo);
  module._presetDefault(2, rate);
  module._reset();
  const length = Math.max(block, outBlock);
  const pointer = module._setBuffers(2, length);
  const view = (index: number) => new Float32Array(module.HEAP8.buffer, pointer + length * 4 * index, length);
  module._setTransposeSemitones(semitones, 8000 / rate);
  const [left, right] = planar(pcm);
  const out = new Float32Array(Math.ceil(left.length / block) * outBlock * 2);
  let written = 0;
  for (let start = 0; start < left.length; start += block) {
    const inputs = [view(0), view(1)];
    inputs[0].fill(0);
    inputs[1].fill(0);
    inputs[0].set(left.subarray(start, start + block));
    inputs[1].set(right.subarray(start, start + block));
    module._process(block, outBlock);
    const outputs = [view(2), view(3)];
    for (let frame = 0; frame < outBlock; frame += 1) {
      out[written++] = outputs[0][frame];
      out[written++] = outputs[1][frame];
    }
  }
  return out;
};

const playerQuanta = (module: any, pcm: Float32Array, semitones: number, audioSeconds: number) => {
  const rate = 44_100;
  const quantum = 128;
  module._presetDefault(2, rate);
  module._reset();
  const inputLatency = module._inputLatency();
  const outputLatency = module._outputLatency();
  const length = Math.max(quantum, inputLatency + outputLatency);
  const pointer = module._setBuffers(2, length);
  const view = (index: number) => new Float32Array(module.HEAP8.buffer, pointer + length * 4 * index, length);
  const [left, right] = planar(pcm);
  const quanta = Math.floor((audioSeconds * rate) / quantum);
  const start = performance.now();
  for (let index = 0; index < quanta; index += 1) {
    module._setTransposeSemitones(semitones, 8000 / rate);
    module._setFormantSemitones(0, false);
    module._setFormantBase(0);
    const end = 44_100 * 30 + index * quantum + outputLatency + inputLatency;
    view(0).set(left.subarray(end - length, end));
    view(1).set(right.subarray(end - length, end));
    module._seek(length, 1);
    module._process(0, quantum);
  }
  return { ms: performance.now() - start, quanta, length };
};

const runJs = async () => {
  const side = mode;
  const pcm48 = await fetchFloats('/results/pcm-48k.f32');
  const pcm44 = await fetchFloats('/results/pcm-44k.f32');
  const audio48 = seconds(pcm48, 48_000);
  const audio44 = seconds(pcm44, 44_100);
  if (mode === 'js') {
    for (const [name, file] of files) {
      const bytes = await fetchBytes(`/data/${file}`);
      try {
        const { ms, kept } = await measure(() => decodeMediabunny(bytes));
        post({ side: 'webcodecs-mediabunny', task: 'decode', case: name, ms, realtime: realtime(ms, seconds(kept.pcm, kept.rate)), frames: kept.pcm.length / 2 });
      } catch (failure) {
        post({ side: 'webcodecs-mediabunny', task: 'decode', case: name, error: String(failure) });
      }
    }
    const rubato = await fetchFloats('/results/native/resample-48k-to-44k.f32');
    {
      const { ms, kept } = await measure(() => resampleLanding(pcm48, 48_000, 44_100));
      post({ side: 'ts-landing', task: 'resample', case: '48k-to-44k', ms, realtime: realtime(ms, audio48), vsRubato: compareAligned(rubato, kept) });
    }
    for (const [name, type] of [['sinc-fastest', ConverterType.SRC_SINC_FASTEST], ['sinc-best', ConverterType.SRC_SINC_BEST_QUALITY]] as const) {
      const { ms, kept } = await measure(() => resampleLibsamplerate(pcm48, 48_000, 44_100, type));
      post({ side: `libsamplerate-${name}`, task: 'resample', case: '48k-to-44k', ms, realtime: realtime(ms, audio48), vsRubato: compareAligned(rubato, kept) });
    }
    for (const [name, codec, bitrate] of [['aac-192', 'mp4a.40.2', 192_000], ['opus-128', 'opus', 128_000], ['flac-16', 'flac', 0], ['mp3-192', 'mp3', 192_000]] as const) {
      try {
        const { ms, kept } = await measure(() => encodeWebCodecs(pcm44, codec, bitrate || undefined as unknown as number));
        post({ side: 'webcodecs', task: 'encode', case: name, ms, realtime: realtime(ms, audio44), bytes: kept });
      } catch (failure) {
        post({ side: 'webcodecs', task: 'encode', case: name, error: String(failure) });
      }
    }
    const module = await loadSignalsmith();
    for (const [name, semitones, tempo] of [['pitch+2', 2, 100], ['tempo80', 0, 80]] as const) {
      const { ms } = await measure(() => stretchSignalsmith(module, pcm44, semitones, tempo));
      post({ side: 'signalsmith-cpp-wasm', task: 'stretch', case: name, ms, realtime: realtime(ms, audio44) });
    }
    const player = playerQuanta(module, pcm44, 2, 20);
    post({ side: 'signalsmith-cpp-wasm', task: 'stretch', case: 'player-quanta-pitch+2', ms: player.ms, realtime: realtime(player.ms, 20), quanta: player.quanta, bufferFrames: player.length });
    return;
  }
  const codec = mode === 'mp3' ? 'mp3' : mode === 'flac' ? 'flac' : 'aac';
  if (codec === 'mp3') registerMp3Encoder();
  if (codec === 'flac') registerFlacEncoder();
  if (codec === 'aac') registerAacEncoder();
  const label = { mp3: 'lame-wasm', flac: 'libflac-wasm', aac: 'libavcodec-aac-wasm' }[codec];
  try {
    const { ms, kept } = await measure(() => encodeMediabunny(pcm44, codec));
    post({ side: label, task: 'encode', case: codec === 'flac' ? 'flac-16' : `${codec}-192`, ms, realtime: realtime(ms, audio44), bytes: kept.length });
  } catch (failure) {
    post({ side: label, task: 'encode', case: codec, error: String(failure) });
  }
};

const runPlayback = async () => {
  const fmp4 = await fetchBytes('/data/stem-48k-fmp4.mp4');
  const flac = await fetchBytes('/data/stem-48k-24.flac');
  {
    const { ms, kept } = await measure(() => decodeMp4(fmp4.slice().buffer, 48_000));
    post({ side: 'app-webcodecs', task: 'playback', case: 'fmp4-aac256-whole', ms, frames: kept.frameCount });
  }
  try {
    const { ms, kept } = await measure(() => decodeMediabunny(flac));
    post({ side: 'webcodecs-mediabunny', task: 'playback', case: 'flac24-whole', ms, frames: kept.pcm.length / 2 });
  } catch (failure) {
    post({ side: 'webcodecs-mediabunny', task: 'playback', case: 'flac24-whole', error: String(failure) });
  }
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/wasm/simd.wasm'), {});
  const rust = wrapRust(instance);
  for (const [name, bytes, extension] of [['flac24-whole', flac, 'flac'], ['fmp4-aac256-whole', fmp4, 'mp4']] as const) {
    const { ms, kept } = await measure(() => rust.decode(bytes, extension));
    post({ side: 'wasm-simd', task: 'playback', case: name, ms, frames: kept.pcm.length / 2 });
  }
  const e = instance.exports as Record<string, any>;
  const memory = e.memory as WebAssembly.Memory;
  const pointer = e.alloc(flac.length);
  new Uint8Array(memory.buffer, pointer, flac.length).set(flac);
  e.keep_file(pointer, flac.length);
  const name = new TextEncoder().encode('flac');
  const namePointer = e.alloc(name.length);
  new Uint8Array(memory.buffer, namePointer, name.length).set(name);
  const times: number[] = [];
  for (let index = 0; index < 21; index += 1) {
    const start = performance.now();
    const length = e.decode_window(namePointer, name.length, 5_000 + index * 9_700, 2_000);
    const window = new Float32Array(memory.buffer, e.floats_ptr(), e.floats_len()).slice();
    times.push(performance.now() - start);
    if (length !== 192_000 || window.length !== 192_000) {
      throw new Error(`window of ${length}`);
    }
  }
  post({ side: 'wasm-simd', task: 'playback', case: 'flac24-window-2s', ms: median(times), maxMs: Math.max(...times), first: times[0] });
};

const runStretchCross = async () => {
  const load = async (variant: string) => wrapRust((await WebAssembly.instantiateStreaming(fetch(`/wasm/${variant}.wasm`), {})).instance);
  const scalar = await load('scalar');
  const simd = await load('simd');
  const pcm44 = await fetchFloats('/results/pcm-44k.f32');
  const native = await fetchFloats('/results/native/stretch-pitch+2.f32');
  const nativeFormants = await fetchFloats('/results/native/stretch-pitch+2-formants.f32');
  const fromScalar = scalar.stretch(pcm44, 44_100, 2, 100, false);
  const fromSimd = simd.stretch(pcm44, 44_100, 2, 100, false);
  const side = 'stretch-cross';
  post({ side, case: 'simd-vs-scalar', wave: compare(fromScalar, fromSimd), spectrum: spectralCompare(fromScalar, fromSimd) });
  post({ side, case: 'scalar-vs-native', wave: compare(native, fromScalar), spectrum: spectralCompare(native, fromScalar) });
  post({ side, case: 'simd-vs-native', wave: compare(native, fromSimd), spectrum: spectralCompare(native, fromSimd) });
  post({ side, case: 'yardstick-formants-on-vs-off-native', wave: compare(native, nativeFormants), spectrum: spectralCompare(native, nativeFormants) });
  const again = simd.stretch(pcm44, 44_100, 2, 100, false);
  post({ side, case: 'simd-run-twice', wave: compare(fromSimd, again) });
};

(async () => {
  try {
    if (mode === 'playback') {
      await runPlayback();
    } else if (mode === 'stretch-cross') {
      await runStretchCross();
    } else if (mode === 'rust-scalar' || mode === 'rust-simd') {
      await runRust(mode.slice(5));
    } else {
      await runJs();
    }
  } catch (failure) {
    post({ side: mode, error: String(failure), stack: (failure as Error).stack });
  }
  self.postMessage({ done: true });
})();
