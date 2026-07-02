import { normalizePeak } from '../dsp/normalize.js';
import { leadBackingModel } from '../models/leadBackingModel.js';
import { type LeadBackingGpuRuntime } from '../runtime/leadBacking/leadBackingRuntime.js';
import { type StereoAudio } from './stereoAudio.js';

export type SeparateLeadBackingMessage = {
  type: 'progress';
  progress: number;
};

export type SeparateLeadBackingOptions = {
  audio: StereoAudio;
  runtime: LeadBackingGpuRuntime;
  onMessage: (message: SeparateLeadBackingMessage) => void | Promise<void>;
};

export type SeparateLeadBackingResult = {
  lead: StereoAudio;
  backing: StereoAudio;
};

const { nFft, compensate, channels, chunkSamples } = leadBackingModel;
const trim = nFft / 2;
const genSamples = chunkSamples - 2 * trim;
const overlap = 0.25;

// Chunking and overlap-add follow the MDX-Net demix flow used by Ultimate
// Vocal Remover GUI, reimplemented for the browser runtime.
const createHanning = (size: number): Float32Array<ArrayBuffer> => {
  const window = new Float32Array(size);
  if (size === 1) {
    window[0] = 1;
    return window;
  }
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
};

const createStereoAudio = (
  source: StereoAudio,
  data: Float32Array<ArrayBuffer>,
): StereoAudio => ({
  sampleRate: source.sampleRate,
  samples: source.samples,
  channels,
  data,
});

const fillChunk = (
  chunk: Float32Array<ArrayBuffer>,
  mixture: Float32Array<ArrayBuffer>,
  mixtureSamples: number,
  start: number,
): number => {
  chunk.fill(0);
  const length = Math.min(chunkSamples, mixtureSamples - start);
  for (let channel = 0; channel < channels; channel++) {
    chunk.set(
      mixture.subarray(
        channel * mixtureSamples + start,
        channel * mixtureSamples + start + length,
      ),
      channel * chunkSamples,
    );
  }
  return length;
};

const overlapAdd = (
  target: Float32Array<ArrayBuffer>,
  divider: Float32Array<ArrayBuffer>,
  chunk: Float32Array<ArrayBuffer>,
  window: Float32Array<ArrayBuffer>,
  mixtureSamples: number,
  start: number,
  length: number,
): void => {
  for (let channel = 0; channel < channels; channel++) {
    for (let i = 0; i < length; i++) {
      const weight = window[i];
      const targetIndex = channel * mixtureSamples + start + i;
      target[targetIndex] += chunk[channel * chunkSamples + i] * weight;
      divider[targetIndex] += weight;
    }
  }
};

type DemixOptions = {
  mixture: Float32Array<ArrayBuffer>;
  samples: number;
  runtime: LeadBackingGpuRuntime;
  onMessage: (message: SeparateLeadBackingMessage) => void | Promise<void>;
};

const demix = async (
  options: DemixOptions,
): Promise<Float32Array<ArrayBuffer>> => {
  const { mixture, samples, runtime, onMessage } = options;
  const padSamples = genSamples + trim - (samples % genSamples);
  const mixtureSamples = trim + samples + padSamples;
  const padded = new Float32Array(channels * mixtureSamples);
  for (let channel = 0; channel < channels; channel++) {
    padded.set(
      mixture.subarray(channel * samples, channel * samples + samples),
      channel * mixtureSamples + trim,
    );
  }

  const step = Math.trunc((1 - overlap) * chunkSamples);
  const totalChunks = Math.ceil(mixtureSamples / step);
  const progressInterval = Math.max(1, Math.floor(totalChunks / 100));
  const result = new Float32Array(channels * mixtureSamples);
  const divider = new Float32Array(channels * mixtureSamples);
  const chunk = new Float32Array(channels * chunkSamples);
  const fullWindow = createHanning(chunkSamples);

  for (
    let chunkIndex = 0, start = 0;
    start < mixtureSamples;
    chunkIndex++, start += step
  ) {
    if (chunkIndex % progressInterval === 0) {
      await onMessage({
        type: 'progress',
        progress: chunkIndex / totalChunks,
      });
    }
    const length = fillChunk(chunk, padded, mixtureSamples, start);
    const separated = await runtime.processChunk(chunk);
    const window = length === chunkSamples ? fullWindow : createHanning(length);
    overlapAdd(
      result,
      divider,
      separated,
      window,
      mixtureSamples,
      start,
      length,
    );
  }

  const target = new Float32Array(channels * samples);
  for (let channel = 0; channel < channels; channel++) {
    for (let sample = 0; sample < samples; sample++) {
      const sourceIndex = channel * mixtureSamples + trim + sample;
      target[channel * samples + sample] =
        result[sourceIndex] / Math.max(divider[sourceIndex], 1e-10);
    }
  }
  await onMessage({ type: 'progress', progress: 1 });
  return target;
};

const validateAudio = (audio: StereoAudio): void => {
  if (audio.data.length !== audio.channels * audio.samples) {
    throw new Error(
      'StereoAudio data length does not match channels * samples',
    );
  }
};

const getPeak = (audio: StereoAudio): number => {
  let peak = 0;
  for (const sample of audio.data) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
};

export const separateLeadBacking = async (
  options: SeparateLeadBackingOptions,
): Promise<SeparateLeadBackingResult> => {
  const { audio } = options;
  validateAudio(audio);

  const peak = getPeak(audio);
  if (peak === 0) {
    throw new Error('Input audio appears to be silent.');
  }

  const mixture = normalizePeak(audio.data, 0.9, 0);
  const primary = await demix({
    mixture,
    samples: audio.samples,
    runtime: options.runtime,
    onMessage: options.onMessage,
  });
  const backingData = new Float32Array(primary.length);
  const leadData = new Float32Array(primary.length);
  for (let i = 0; i < primary.length; i++) {
    const backingSample = primary[i];
    // UVR/MDX residual separation is mix - primary * compensate. Since this
    // path normalizes mix before demix, compute that residual before restoring
    // the original peak to avoid mixing normalized and denormalized amplitudes.
    const leadSample = mixture[i] - backingSample * compensate;
    backingData[i] = backingSample * peak;
    leadData[i] = leadSample * peak;
  }

  return {
    lead: createStereoAudio(audio, normalizePeak(leadData, 0.9, 0)),
    backing: createStereoAudio(audio, normalizePeak(backingData, 0.9, 0)),
  };
};
