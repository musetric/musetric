import { separateAudio } from '@musetric/ai/node';
import {
  analyzeLoudness,
  convertToFmp4,
  generateWavePeaks,
} from '@musetric/ffmpeg';
import { analyzeStemLoudness } from '../stemLoudness.js';
import { type ProcessingStep } from './types.js';

export const runSeparation: ProcessingStep = async (context) => {
  const { app, logger, task, handlers } = context;
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

  const audioAnalysis = await analyzeStemLoudness({
    sourceAnalysis: await sourceAnalysisPromise,
    stemPaths: {
      lead: masterLead.blobPath,
      backing: masterBacking.blobPath,
      instrumental: masterInstrumental.blobPath,
    },
    sampleRate: project.sampleRate,
    logger,
  });
  await app.db.processing.applySeparationResult({
    projectId: task.projectId,
    audioAnalysis,
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
};
