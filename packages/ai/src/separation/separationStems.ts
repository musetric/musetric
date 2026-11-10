export const stemNames = ['vocals', 'instrumental', 'lead', 'backing'] as const;

export const stereoChannels = 2;
export const maxPeak = 0.9;

export type StemName = (typeof stemNames)[number];

export type StemValues = Record<StemName, number>;

export const silentPeaks = (): StemValues => ({
  vocals: 0,
  instrumental: 0,
  lead: 0,
  backing: 0,
});

export const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (const value of samples) {
    peak = Math.max(peak, Math.abs(value));
  }
  return peak;
};

export const peakScale = (peak: number): number =>
  peak === 0 || peak <= maxPeak ? 1 : maxPeak / peak;

export const stemScales = (peaks: StemValues): StemValues => ({
  vocals: peakScale(peaks.vocals),
  instrumental: peakScale(peaks.instrumental),
  lead: peakScale(peaks.lead),
  backing: peakScale(peaks.backing),
});

export type StemRegion = {
  vocals: Float32Array[];
  backing: Float32Array[];
  mixture: Float32Array[];
  offset: number;
};

export type SeparatedStems = Record<StemName, Float32Array<ArrayBuffer>>;

export const separateStems = (region: StemRegion): SeparatedStems => {
  const frames = region.vocals[0].length;
  const stems: SeparatedStems = {
    vocals: new Float32Array(frames * stereoChannels),
    instrumental: new Float32Array(frames * stereoChannels),
    lead: new Float32Array(frames * stereoChannels),
    backing: new Float32Array(frames * stereoChannels),
  };
  for (let channel = 0; channel < stereoChannels; channel += 1) {
    const vocals = region.vocals[channel];
    const backing = region.backing[channel];
    const mixture = region.mixture[channel];
    for (let frame = 0; frame < frames; frame += 1) {
      const at = frame * stereoChannels + channel;
      stems.vocals[at] = vocals[frame];
      stems.backing[at] = backing[frame];
      stems.instrumental[at] = mixture[region.offset + frame] - vocals[frame];
      stems.lead[at] = vocals[frame] - backing[frame];
    }
  }
  return stems;
};

export const raisePeaks = (
  peaks: StemValues,
  stems: SeparatedStems,
): StemValues => ({
  vocals: Math.max(peaks.vocals, peakOf(stems.vocals)),
  instrumental: Math.max(peaks.instrumental, peakOf(stems.instrumental)),
  lead: Math.max(peaks.lead, peakOf(stems.lead)),
  backing: Math.max(peaks.backing, peakOf(stems.backing)),
});
