import { separateAudio } from '@musetric/ai/node';
import {
  analyzeLeadVisualLoudness,
  analyzeLoudness,
  convertToFmp4,
  generateWavePeaks,
} from '@musetric/toolkit';
import {
  type EventEmitter,
  type Logger,
  sourceTargetLufs,
} from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { type AnalysisWorker, createAnalysisWorker } from './analysisWorker.js';
import { type ProcessingWorkerEvent } from './processingSummary.js';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sourceTruePeakCeilingDb = -1;
const sourceMaxBoostDb = 18;
const sourceMaxCutDb = -12;

const leadVisualTargetP95RmsDb = -22;
const leadVisualPeakCeilingDb = 3;
const leadVisualMaxBoostDb = 48;
const leadVisualMaxCutDb = -12;

type SourceAnalysis = {
  integratedLoudnessDb: number;
  truePeakDb: number;
};

const calculateSourceGainDb = (analysis: SourceAnalysis) =>
  clamp(
    Math.min(
      sourceTargetLufs - analysis.integratedLoudnessDb,
      sourceTruePeakCeilingDb - analysis.truePeakDb,
    ),
    sourceMaxCutDb,
    sourceMaxBoostDb,
  );

type LeadAnalysis = {
  p95RmsDb: number;
  truePeakDb: number;
};

const calculateLeadSpectrogramGainDb = (analysis: LeadAnalysis) =>
  clamp(
    leadVisualTargetP95RmsDb - analysis.p95RmsDb,
    leadVisualMaxCutDb,
    Math.min(
      leadVisualMaxBoostDb,
      leadVisualPeakCeilingDb - analysis.truePeakDb,
    ),
  );

export type SeparationTask = {
  projectId: number;
  blobId: string;
};

export type SeparationWorker = AnalysisWorker<SeparationTask>;

export const createSeparationWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): SeparationWorker =>
  createAnalysisWorker<SeparationTask>(emitter, logger, {
    step: 'separation',
    errorMessage: 'Separation failed',
    process: async (task, handlers) => {
      const project = await app.db.project.get(task.projectId);
      if (!project) {
        throw new Error(`Project with id ${task.projectId} not found`);
      }

      const masterSourcePath = app.blobStorage.getPath(task.blobId);
      const sourceAnalysisPromise = analyzeLoudness({
        fromPath: masterSourcePath,
        logger,
      });
      const masterLead = app.blobStorage.createPath();
      const masterBacking = app.blobStorage.createPath();
      const masterInstrumental = app.blobStorage.createPath();

      await separateAudio({
        gpuHost: app.gpuHost,
        sourcePath: masterSourcePath,
        leadPath: masterLead.blobPath,
        backingPath: masterBacking.blobPath,
        instrumentalPath: masterInstrumental.blobPath,
        sampleRate: project.sampleRate,
        handlers,
        modelsPath: app.config.modelsPath,
        logger,
      });

      const deliveryLead = app.blobStorage.createPath();
      const deliveryBacking = app.blobStorage.createPath();
      const deliveryInstrumental = app.blobStorage.createPath();
      await Promise.all([
        convertToFmp4({
          fromPath: masterLead.blobPath,
          toPath: deliveryLead.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
        convertToFmp4({
          fromPath: masterBacking.blobPath,
          toPath: deliveryBacking.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
        convertToFmp4({
          fromPath: masterInstrumental.blobPath,
          toPath: deliveryInstrumental.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
      ]);

      const wavePeaksLead = app.blobStorage.createPath();
      const wavePeaksBacking = app.blobStorage.createPath();
      const wavePeaksInstrumental = app.blobStorage.createPath();
      await Promise.all([
        generateWavePeaks({
          fromPath: masterLead.blobPath,
          toPath: wavePeaksLead.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
        generateWavePeaks({
          fromPath: masterBacking.blobPath,
          toPath: wavePeaksBacking.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
        generateWavePeaks({
          fromPath: masterInstrumental.blobPath,
          toPath: wavePeaksInstrumental.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
      ]);

      const [sourceAnalysis, leadAnalysis] = await Promise.all([
        sourceAnalysisPromise,
        analyzeLeadVisualLoudness({
          fromPath: masterLead.blobPath,
          sampleRate: project.sampleRate,
          logger,
        }),
      ]);

      await app.db.processing.applySeparationResult({
        projectId: task.projectId,
        audioAnalysis: {
          sourceIntegratedLoudnessDb: sourceAnalysis.integratedLoudnessDb,
          sourceTruePeakDb: sourceAnalysis.truePeakDb,
          sourceGainDb: calculateSourceGainDb(sourceAnalysis),
          leadIntegratedLoudnessDb: leadAnalysis.integratedLoudnessDb,
          leadTruePeakDb: leadAnalysis.truePeakDb,
          leadP95RmsDb: leadAnalysis.p95RmsDb,
          leadSpectrogramGainDb: calculateLeadSpectrogramGainDb(leadAnalysis),
        },
        master: {
          leadId: masterLead.blobId,
          backingId: masterBacking.blobId,
          instrumentalId: masterInstrumental.blobId,
        },
        delivery: {
          leadId: deliveryLead.blobId,
          backingId: deliveryBacking.blobId,
          instrumentalId: deliveryInstrumental.blobId,
        },
        wavePeaks: {
          leadId: wavePeaksLead.blobId,
          backingId: wavePeaksBacking.blobId,
          instrumentalId: wavePeaksInstrumental.blobId,
        },
      });
    },
  });
