import { getRecordingLatencyCalibrationOutcome } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';

const rate = 48000;
const clickFrames = [0.25, 1.25, 2.25, 3.25, 4.25].map(
  (seconds) => seconds * rate,
);

const quietRoom = 0.002;

const toPeaks = (
  delaysSeconds: number[],
  peakValue: number,
  noiseValue = quietRoom,
) =>
  clickFrames.map((clickFrame, index) => ({
    clickFrame,
    onsetFrame: clickFrame + Math.round(delaysSeconds[index] * rate),
    peakValue,
    noiseValue,
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

  it('measures soft clicks in a quiet room', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.561, 0.561, 0.562, 0.561, 0.562], 0.03),
      rate,
    );
    expect(outcome.kind).toBe('measured');
  });

  it('calls a loud room noise', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.002, 0.177, 0.031, 0.053, 0.095], 0.33, 0.05),
      rate,
    );
    expect(outcome).toEqual({ kind: 'noisy' });
  });

  it('does not take the noise at the start of each window for clicks', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.002, 0.003, 0.002, 0.004, 0.002], 0.012),
      rate,
    );
    expect(outcome).toEqual({ kind: 'silent' });
  });

  it('calls faint clicks at a steady delay too quiet', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.38, 0.381, 0.379, 0.38, 0.382], 0.016),
      rate,
    );
    expect(outcome).toEqual({ kind: 'quiet' });
  });

  it('calls faint peaks at scattered delays silence', () => {
    const outcome = getRecordingLatencyCalibrationOutcome(
      toPeaks([0.12, 0.48, 0.77, 0.3, 0.62], 0.016),
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
