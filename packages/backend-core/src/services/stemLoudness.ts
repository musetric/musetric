import { type DB } from '@musetric/backend-db';
import {
  analyzeLeadVisualLoudness,
  analyzeLoudness,
  type LoudnessAnalysis,
} from '@musetric/ffmpeg';
import {
  calculateLeadSpectrogramGainDb,
  calculatePracticeGainsDb,
  calculateSourceGainDb,
  type Logger,
} from '@musetric/utils';

export type StemPaths = {
  lead: string;
  backing: string;
  instrumental: string;
};

export type AnalyzeStemLoudnessArg = {
  sourceAnalysis: LoudnessAnalysis;
  stemPaths: StemPaths;
  sampleRate: number;
  logger: Logger;
};

export type StemLoudnessAnalysis =
  DB.processing.ApplySeparationResultArg['audioAnalysis'];

export const analyzeStemLoudness = async (
  arg: AnalyzeStemLoudnessArg,
): Promise<StemLoudnessAnalysis> => {
  const { sourceAnalysis, stemPaths, sampleRate, logger } = arg;

  const [lead, backing, instrumental] = await Promise.all([
    analyzeLeadVisualLoudness({ fromPath: stemPaths.lead, sampleRate, logger }),
    analyzeLoudness({ fromPath: stemPaths.backing, logger }),
    analyzeLoudness({ fromPath: stemPaths.instrumental, logger }),
  ]);

  const sourceGainDb = calculateSourceGainDb(sourceAnalysis);
  const practiceGainsDb = calculatePracticeGainsDb({
    sourceGainDb,
    lead,
    backing,
    instrumental,
  });

  return {
    sourceIntegratedLoudnessDb: sourceAnalysis.integratedLoudnessDb,
    sourceTruePeakDb: sourceAnalysis.truePeakDb,
    sourceGainDb,
    leadIntegratedLoudnessDb: lead.integratedLoudnessDb,
    leadTruePeakDb: lead.truePeakDb,
    leadP95RmsDb: lead.p95RmsDb,
    leadSpectrogramGainDb: calculateLeadSpectrogramGainDb(lead),
    backingIntegratedLoudnessDb: backing.integratedLoudnessDb,
    backingTruePeakDb: backing.truePeakDb,
    instrumentalIntegratedLoudnessDb: instrumental.integratedLoudnessDb,
    instrumentalTruePeakDb: instrumental.truePeakDb,
    leadGainDb: practiceGainsDb.lead,
    backingGainDb: practiceGainsDb.backing,
    instrumentalGainDb: practiceGainsDb.instrumental,
  };
};
