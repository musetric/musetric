export const cqtToneAmplitude = 0.5;
export const cqtToneSeconds = 4;

export type CqtToneReference = {
  bin: number;
  peakMagnitude: number;
};

export const cqtToneReferences: CqtToneReference[] = [
  { bin: 0, peakMagnitude: 38.211262 },
  { bin: 12, peakMagnitude: 32.11541 },
  { bin: 23, peakMagnitude: 27.398172 },
  { bin: 24, peakMagnitude: 27.019209 },
  { bin: 47, peakMagnitude: 19.373188 },
  { bin: 48, peakMagnitude: 19.105656 },
  { bin: 71, peakMagnitude: 13.699096 },
  { bin: 72, peakMagnitude: 13.50953 },
  { bin: 95, peakMagnitude: 9.686647 },
  { bin: 96, peakMagnitude: 9.552778 },
  { bin: 119, peakMagnitude: 6.849493 },
  { bin: 120, peakMagnitude: 6.754834 },
  { bin: 143, peakMagnitude: 4.843322 },
];
