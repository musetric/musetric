import { getRecordingLatencyCalibrationOutcome } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';

const rate = 48000;
const clickFrames = [0.25, 1.25, 2.25, 3.25, 4.25].map(
  (seconds) => seconds * rate,
);

const toPeaks = (delaysSeconds: number[], peakValue: number) =>
  clickFrames.map((clickFrame, index) => ({
    clickFrame,
    onsetFrame: clickFrame + Math.round(delaysSeconds[index] * rate),
    peakValue,
  }));

describe('calibration outcome', () => {
  it('measures clicks heard clearly', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.38, 0.38, 0.381, 0.379, 0.38], 0.2),
      rate,
    );
    expect(outcome.kind).toBe('measured');
  });

  it('measures the clicks that agree and leaves out the stray ones', () => {
    const peaks = toPeaks([0.38, 0.05, 0.381, 0.379, 0.62], 0.2);
    const outcome = getRecordingLatencyCalibrationOutcome(peaks, rate);
    expect(outcome).toEqual({
      kind: 'measured',
      measuredLatencyFrameCounts: [0.38, 0.381, 0.379].map((seconds) =>
        Math.round(seconds * rate),
      ),
    });
  });

  it('calls loud peaks at scattered delays noise', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.002, 0.177, 0.031, 0.053, 0.095], 0.33),
      rate,
    );
    expect(outcome).toEqual({ kind: 'noisy' });
  });

  it('calls faint clicks at a steady delay too quiet', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.38, 0.381, 0.379, 0.38, 0.382], 0.01),
      rate,
    );
    expect(outcome).toEqual({ kind: 'quiet' });
  });

  it('calls faint peaks at scattered delays silence', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.12, 0.48, 0.77, 0.3, 0.62], 0.01),
      rate,
    );
    expect(outcome).toEqual({ kind: 'silent' });
  });

  it('calls a quiet room silence', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.38, 0.38, 0.38, 0.38, 0.38], 0.001),
      rate,
    );
    expect(outcome).toEqual({ kind: 'silent' });
  });
});
