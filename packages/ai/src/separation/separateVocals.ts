import { normalizePeak, subtractPlanarStereo } from '../dsp/normalize.js';
import { vocalsModel } from '../models/vocalsModel.js';
import { type VocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import { type StereoAudio } from './stereoAudio.js';

export type SeparateVocalsMessage = {
  type: 'progress';
  progress: number;
};

export type SeparateVocalsOptions = {
  audio: StereoAudio;
  runtime: VocalsGpuRuntime;
  onMessage: (message: SeparateVocalsMessage) => void | Promise<void>;
};

export type SeparateVocalsResult = {
  vocals: StereoAudio;
  instrumental: StereoAudio;
};

// Chunking and overlap-add follow the Mel-Band RoFormer vocal separation
// model contract used by the WebGPU ONNX runtime.
const fillChunk = (
  chunk: Float32Array<ArrayBuffer>,
  mix: Float32Array<ArrayBuffer>,
  samples: number,
  start: number,
  length: number,
): void => {
  if (length < vocalsModel.chunkSamples) {
    chunk.fill(0);
  }
  for (let channel = 0; channel < vocalsModel.channels; channel++) {
    const sourceOffset = channel * samples + start;
    const targetOffset = channel * vocalsModel.chunkSamples;
    chunk.set(mix.subarray(sourceOffset, sourceOffset + length), targetOffset);
  }
};

const createHammingWindow = (): Float32Array<ArrayBuffer> => {
  const output = new Float32Array(vocalsModel.chunkSamples);
  for (let i = 0; i < vocalsModel.chunkSamples; i++) {
    output[i] =
      0.54 - 0.46 * Math.cos((2 * Math.PI * i) / vocalsModel.chunkSamples);
  }
  return output;
};

const overlapAddChunk = (
  target: Float32Array<ArrayBuffer>,
  counter: Float32Array<ArrayBuffer>,
  chunk: Float32Array<ArrayBuffer>,
  samples: number,
  start: number,
  length: number,
  window: Float32Array<ArrayBuffer>,
): void => {
  for (let channel = 0; channel < vocalsModel.channels; channel++) {
    const outputOffset = channel * samples + start;
    const chunkOffset = channel * vocalsModel.chunkSamples;
    for (let i = 0; i < length; i++) {
      const weight = window[i];
      target[outputOffset + i] += chunk[chunkOffset + i] * weight;
      counter[outputOffset + i] += weight;
    }
  }
};

const finalizeOverlap = (
  target: Float32Array<ArrayBuffer>,
  counter: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> => {
  const output = new Float32Array(target.length);
  for (let i = 0; i < target.length; i++) {
    output[i] = target[i] / Math.max(counter[i], 1e-10);
  }
  return output;
};

const createStereoAudio = (
  source: StereoAudio,
  data: Float32Array<ArrayBuffer>,
): StereoAudio => ({
  sampleRate: source.sampleRate,
  samples: source.samples,
  channels: vocalsModel.channels,
  data,
});

const validateAudio = (audio: StereoAudio): void => {
  if (audio.sampleRate !== vocalsModel.sampleRate) {
    throw new Error(
      `Vocals separation requires ${vocalsModel.sampleRate} Hz audio`,
    );
  }
  if (audio.data.length !== audio.channels * audio.samples) {
    throw new Error(
      'StereoAudio data length does not match channels * samples',
    );
  }
};

const getChunkWindow = (
  offset: number,
  samples: number,
): { start: number; length: number } => {
  if (offset + vocalsModel.chunkSamples <= samples) {
    return {
      start: offset,
      length: Math.min(vocalsModel.chunkSamples, samples - offset),
    };
  }
  if (samples >= vocalsModel.chunkSamples) {
    return {
      start: samples - vocalsModel.chunkSamples,
      length: vocalsModel.chunkSamples,
    };
  }
  return { start: 0, length: samples };
};

export const separateVocals = async (
  options: SeparateVocalsOptions,
): Promise<SeparateVocalsResult> => {
  const sourceAudio = options.audio;
  validateAudio(sourceAudio);

  const mixture = normalizePeak(sourceAudio.data, 0.9, 0);
  const stepSize = Math.min(
    8 * sourceAudio.sampleRate,
    vocalsModel.chunkSamples,
  );
  const window = createHammingWindow();
  const chunk = new Float32Array(
    vocalsModel.channels * vocalsModel.chunkSamples,
  );
  const separatedChunk = new Float32Array(chunk.length);
  const target = new Float32Array(mixture.length);
  const counter = new Float32Array(mixture.length);
  const totalSteps = Math.ceil(sourceAudio.samples / stepSize);

  for (
    let stepIndex = 0, offset = 0;
    offset < sourceAudio.samples;
    stepIndex++, offset += stepSize
  ) {
    await options.onMessage({
      type: 'progress',
      progress: stepIndex / totalSteps,
    });

    const chunkWindow = getChunkWindow(offset, sourceAudio.samples);
    fillChunk(
      chunk,
      mixture,
      sourceAudio.samples,
      chunkWindow.start,
      chunkWindow.length,
    );
    await options.runtime.processChunk({
      input: chunk,
      output: separatedChunk,
    });
    overlapAddChunk(
      target,
      counter,
      separatedChunk,
      sourceAudio.samples,
      chunkWindow.start,
      chunkWindow.length,
      window,
    );
  }

  const rawVocals = finalizeOverlap(target, counter);
  const vocals = normalizePeak(rawVocals, 0.9, 0);
  const instrumental = normalizePeak(
    subtractPlanarStereo(mixture, rawVocals),
    0.9,
    0,
  );

  await options.onMessage({ type: 'progress', progress: 1 });

  return {
    vocals: createStereoAudio(sourceAudio, vocals),
    instrumental: createStereoAudio(sourceAudio, instrumental),
  };
};
