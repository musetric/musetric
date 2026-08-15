import { createNumberLimit } from './numberLimit.js';

export const sourceTargetLufs = -16;
export const waveformVisualPeakCeilingDb = -0.5;

const sourceTruePeakCeilingDb = -1;
const sourceGainLimit = createNumberLimit({ minimum: -12, maximum: 18 });

const practiceVocalRatioDb = 5;
const silentStemLufs = -40;
const stemGainLimit = createNumberLimit({ minimum: -12, maximum: 12 });

const leadVisualTargetP95RmsDb = -22;
const leadVisualPeakCeilingDb = 3;
const leadVisualGainLimit = createNumberLimit({ minimum: -12, maximum: 48 });

export type LoudnessMeasurement = {
  integratedLoudnessDb: number;
  truePeakDb: number;
};

export const calculateSourceGainDb = (
  measurement: LoudnessMeasurement,
): number =>
  sourceGainLimit.clamp(
    Math.min(
      sourceTargetLufs - measurement.integratedLoudnessDb,
      sourceTruePeakCeilingDb - measurement.truePeakDb,
    ),
  );

export type LeadVisualMeasurement = LoudnessMeasurement & {
  p95RmsDb: number;
};

export const calculateLeadSpectrogramGainDb = (
  measurement: LeadVisualMeasurement,
): number =>
  Math.min(
    leadVisualGainLimit.clamp(leadVisualTargetP95RmsDb - measurement.p95RmsDb),
    leadVisualPeakCeilingDb - measurement.truePeakDb,
  );

export type PracticeGainsDb = {
  lead: number;
  backing: number;
  instrumental: number;
};

export type PracticeGainsArg = {
  sourceGainDb: number;
  lead: LoudnessMeasurement;
  backing: LoudnessMeasurement;
  instrumental: LoudnessMeasurement;
};

export const calculatePracticeGainsDb = (
  arg: PracticeGainsArg,
): PracticeGainsDb => {
  const leadLoudnessDb = arg.lead.integratedLoudnessDb;
  if (leadLoudnessDb < silentStemLufs) {
    return {
      lead: arg.sourceGainDb,
      backing: arg.sourceGainDb,
      instrumental: arg.sourceGainDb,
    };
  }

  const backingTargetLufs = sourceTargetLufs - practiceVocalRatioDb;
  return {
    lead: stemGainLimit.clamp(sourceTargetLufs - leadLoudnessDb),
    backing: stemGainLimit.clamp(
      backingTargetLufs - arg.backing.integratedLoudnessDb,
    ),
    instrumental: stemGainLimit.clamp(
      backingTargetLufs - arg.instrumental.integratedLoudnessDb,
    ),
  };
};
