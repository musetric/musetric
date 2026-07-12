import { fftInPlace, hanningWindow, sampleRate } from './spectralChunker.js';

const onsetBandHz: [number, number] = [100, 4000];
const onsetMinFrames = 5;
const onsetWin = 1024;
const onsetHop = 256;

const spectralFlux = (audio: Float32Array): Float32Array => {
  const frameCount = Math.floor((audio.length - onsetWin) / onsetHop) + 1;
  const window = hanningWindow(onsetWin);
  const binHz = sampleRate / onsetWin;
  const loBin = Math.max(0, Math.ceil(onsetBandHz[0] / binHz));
  const hiBin = Math.min(onsetWin / 2, Math.floor(onsetBandHz[1] / binHz));
  const re = new Float64Array(onsetWin);
  const im = new Float64Array(onsetWin);
  const flux = new Float32Array(Math.max(0, frameCount - 1));
  let prevMag: Float64Array | undefined = undefined;
  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * onsetHop;
    for (let i = 0; i < onsetWin; i++) {
      re[i] = audio[offset + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    const mag = new Float64Array(hiBin - loBin + 1);
    for (let k = loBin; k <= hiBin; k++) {
      mag[k - loBin] = Math.hypot(re[k], im[k]);
    }
    if (prevMag) {
      let sum = 0;
      for (let k = 0; k < mag.length; k++) {
        sum += Math.max(0, mag[k] - prevMag[k]);
      }
      flux[frame - 1] = sum;
    }
    prevMag = mag;
  }
  return flux;
};

const countFluxPeaks = (flux: Float32Array): number => {
  let maxFlux = 0;
  for (const value of flux) {
    maxFlux = Math.max(maxFlux, value);
  }
  if (maxFlux <= 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < flux.length; i++) {
    flux[i] /= maxFlux;
    sum += flux[i];
  }
  const mean = sum / flux.length;
  let varSum = 0;
  for (const value of flux) {
    varSum += (value - mean) * (value - mean);
  }
  const std = Math.sqrt(varSum / flux.length);
  const floor = Math.max(0.12, mean + 0.5 * std);
  const gap = Math.round((0.11 * sampleRate) / onsetHop);
  let onsets = 0;
  let last = -gap;
  for (let i = 1; i < flux.length - 1; i++) {
    if (
      flux[i] >= floor &&
      flux[i] >= flux[i - 1] &&
      flux[i] > flux[i + 1] &&
      i - last >= gap
    ) {
      onsets += 1;
      last = i;
    }
  }
  return onsets;
};

export const syllableOnsets = (audio: Float32Array): number => {
  if (audio.length < onsetWin * 2) {
    return 0;
  }
  const flux = spectralFlux(audio);
  if (flux.length < onsetMinFrames) {
    return 0;
  }
  return countFluxPeaks(flux);
};
