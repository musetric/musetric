import {
  normalizeSpectrogramMaxFrequency,
  normalizeSpectrogramMinFrequency,
} from './common/frequencyRange.js';
import { type SpectrogramVisualConfig } from './config.cross.js';

const notesMarginSemitones = 2;
const notesMinimumSemitones = 18;
const spectrumMarginSemitones = 3;
const visibleIntensity = 0.3;
const tiltAnchorFrequency = 440;

const semitoneOf = (frequency: number): number =>
  12 * Math.log2(frequency / 440) + 69;

const frequencyOf = (semitone: number): number =>
  440 * 2 ** ((semitone - 69) / 12);

export type VoicePitchRange = {
  minFrequency: number;
  maxFrequency: number;
};

export type VoiceViewRange = {
  minFrequency: number;
  maxFrequency: number;
};

const notesRangeOf = (pitch: VoicePitchRange): VoiceViewRange => {
  let low = Math.floor(semitoneOf(pitch.minFrequency) - notesMarginSemitones);
  let high = Math.ceil(semitoneOf(pitch.maxFrequency) + notesMarginSemitones);
  const missing = Math.max(0, notesMinimumSemitones - (high - low));
  low -= Math.floor(missing / 2);
  high += Math.ceil(missing / 2);
  return {
    minFrequency: frequencyOf(low - 0.5),
    maxFrequency: frequencyOf(high + 0.5),
  };
};

export type VoiceSpectrumBand = {
  minFrequency: number;
  maxFrequency: number;
  levelDb: number;
};

export type VoiceRange = {
  pitch?: VoicePitchRange;
  bands: VoiceSpectrumBand[];
};

export type VoiceViewRanges = {
  notes: VoiceViewRange;
  spectrum: VoiceViewRange;
};

export type VoiceViewRangesArg = {
  voiceRange: VoiceRange;
  gainDb: number;
  minDecibel: number;
  visual: SpectrogramVisualConfig;
  fallback: VoiceViewRanges;
};

const displayedIntensity = (
  band: VoiceSpectrumBand,
  arg: VoiceViewRangesArg,
): number => {
  const { visual } = arg;
  const center = Math.sqrt(band.minFrequency * band.maxFrequency);
  const tilt = Math.min(
    Math.max(
      (center / tiltAnchorFrequency) ** visual.frequencyTiltSlope,
      visual.frequencyTiltMinGain,
    ),
    visual.frequencyTiltMaxGain,
  );
  const decibel = Math.max(
    1 + (band.levelDb + arg.gainDb) / -arg.minDecibel,
    0,
  );
  const intensity = Math.min(decibel * tilt, 1);
  return intensity ** Math.max(visual.displayGamma, 0.001);
};

const spectrumTopOf = (arg: VoiceViewRangesArg): number => {
  let top = arg.fallback.spectrum.maxFrequency;
  for (const band of arg.voiceRange.bands) {
    if (band.maxFrequency <= top) {
      continue;
    }
    if (displayedIntensity(band, arg) < visibleIntensity) {
      break;
    }
    top = band.maxFrequency;
  }
  return top;
};

const spectrumRangeOf = (
  pitch: VoicePitchRange,
  arg: VoiceViewRangesArg,
): VoiceViewRange => {
  const top = spectrumTopOf(arg);
  const bottom = frequencyOf(
    semitoneOf(pitch.minFrequency) - spectrumMarginSemitones,
  );
  const minFrequency = normalizeSpectrogramMinFrequency(bottom, top);
  return {
    minFrequency,
    maxFrequency: normalizeSpectrogramMaxFrequency(top, minFrequency),
  };
};

export const voiceViewRanges = (arg: VoiceViewRangesArg): VoiceViewRanges => {
  const { pitch } = arg.voiceRange;
  if (!pitch) {
    return arg.fallback;
  }
  return {
    notes: notesRangeOf(pitch),
    spectrum: spectrumRangeOf(pitch, arg),
  };
};
