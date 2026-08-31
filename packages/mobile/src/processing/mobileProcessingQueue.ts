import { type api } from '@musetric/api';
import { analyzeTrack } from '../analysis/index.js';
import { acquireScreenWakeLock } from '../app/acquireScreenWakeLock.js';
import { createModelStore, type ModelProgress } from '../models/index.js';
import {
  createProjectStore,
  type MobileProject,
  type MobileProjectProcessing,
  type MobileProjectStem,
} from '../projects/index.js';
import {
  runWithGpuFailureTracking,
  separateTrack,
  waitForWebGpuExecutor,
} from '../separation/index.js';
import { type StorageClient } from '../storage/index.js';
import { transcribeTrack } from '../transcription/index.js';

const createStep = (
  status: api.project.ProcessingStep['status'],
): api.project.ProcessingStep => ({
  status,
});

const createPendingProcessing = (): MobileProjectProcessing => ({
  done: false,
  steps: {
    separation: createStep('pending'),
    transcription: createStep('pending'),
    rhythm: createStep('pending'),
    key: createStep('pending'),
    chords: createStep('pending'),
  },
});

const copyProcessing = (project: MobileProject): MobileProjectProcessing => {
  const processing = project.processing ?? createPendingProcessing();
  return {
    ...processing,
    steps: {
      separation: { ...processing.steps.separation },
      transcription: { ...processing.steps.transcription },
      rhythm: { ...processing.steps.rhythm },
      key: { ...processing.steps.key },
      chords: { ...processing.steps.chords },
    },
  };
};

const toDownload = (progress: ModelProgress) => ({
  label: progress.label,
  file: progress.file,
  downloaded: progress.downloaded,
  total: progress.total,
  status: progress.cached ? ('cached' as const) : ('processing' as const),
});

const fraction = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.max(0, Math.min(1, value));

const hasProcessingFailure = (project: MobileProject): boolean =>
  Object.values(project.processing?.steps ?? {}).some(
    (step) => step.status === 'failed',
  );

const savedStems = (
  project: MobileProject,
): MobileProjectStem[] | undefined =>
  project.processing?.steps.separation.status === 'done' &&
  project.stems !== undefined &&
  project.stems.length === 3
    ? project.stems
    : undefined;

type StepName = keyof MobileProjectProcessing['steps'];

const getAnalysisStep = (stage: string): StepName | undefined => {
  if (stage.includes('chord')) {
    return 'chords';
  }
  if (stage.includes('key')) {
    return 'key';
  }
  if (stage.includes('rhythm') || stage.includes('beat')) {
    return 'rhythm';
  }
  return undefined;
};

const isProjectComplete = (project: MobileProject): boolean =>
  project.processing?.done === true ||
  (project.analysis !== undefined &&
    project.stems !== undefined &&
    project.stems.length === 3 &&
    project.transcript !== undefined);

type MobileProcessingQueue = {
  start: () => () => void;
};

export const createMobileProcessingQueue = (
  storage: StorageClient,
): MobileProcessingQueue => {
  const projects = createProjectStore(storage);
  const models = createModelStore(storage);
  const activeProjectIds = new Set<string>();
  let draining = false;

  const updateStep = async (
    project: MobileProject,
    stepName: StepName,
    update: Partial<api.project.ProcessingStep>,
  ): Promise<MobileProject> => {
    const processing = copyProcessing(project);
    processing.steps[stepName] = {
      ...processing.steps[stepName],
      ...update,
    };
    return await projects.saveProcessing(project, processing);
  };

  const markDone = async (
    project: MobileProject,
    stepName: StepName,
  ): Promise<MobileProject> =>
    await updateStep(project, stepName, {
      status: 'done',
      progress: 1,
      download: undefined,
      message: undefined,
      error: undefined,
    });

  const processProject = async (
    initialProject: MobileProject,
  ): Promise<void> => {
    if (activeProjectIds.has(initialProject.id)) {
      return;
    }
    activeProjectIds.add(initialProject.id);
    const wakeLock = await acquireScreenWakeLock();
    let project = initialProject;
    let activeStep: StepName = 'separation';
    let pendingProjectWrite: Promise<MobileProject> = Promise.resolve(project);
    try {
      const source = await storage.readFile(initialProject.sourcePath);
      if (source === undefined) {
        throw new Error('The source audio file is no longer available');
      }
      const queueStepUpdate = (
        stepName: StepName,
        update: Partial<api.project.ProcessingStep>,
      ): void => {
        pendingProjectWrite = pendingProjectWrite.then(async () => {
          project = await updateStep(project, stepName, update);
          return project;
        });
      };
      const waitForQueuedWrite = async (): Promise<void> => {
        project = await pendingProjectWrite;
      };
      let stems = savedStems(project);
      if (!stems) {
        project = await updateStep(project, 'separation', {
          status: 'processing',
          progress: 0,
          message: 'Preparing separation',
          error: undefined,
          download: undefined,
        });
        await waitForQueuedWrite();
        await waitForWebGpuExecutor();
        stems = await runWithGpuFailureTracking(project.id, async () =>
          await separateTrack({
            source: source.slice().buffer,
            projectId: project.id,
            models,
            storage,
            onModelProgress: (progress) => {
              queueStepUpdate('separation', {
                status: 'processing',
                message: undefined,
                download: toDownload(progress),
              });
            },
            onProgress: (stage, progress) => {
              queueStepUpdate('separation', {
                status: 'processing',
                progress: fraction(progress),
                message: stage,
                download: undefined,
              });
            },
          }),
        );
        await waitForQueuedWrite();
        project = await projects.saveStems(project, stems);
        project = await markDone(project, 'separation');
      }

      const hasTranscript =
        project.processing?.steps.transcription.status === 'done' &&
        project.transcript !== undefined;
      if (!hasTranscript) {
        project = await updateStep(project, 'transcription', {
          status: 'processing',
          progress: 0,
          error: undefined,
          message: undefined,
          download: undefined,
        });
        activeStep = 'transcription';
        const lead = stems.find((stem) => stem.id === 'lead');
        const transcriptionSource = lead
          ? await storage.readFile(lead.path)
          : source;
        if (transcriptionSource === undefined) {
          throw new Error('The lead vocal audio file is no longer available');
        }
        const transcript = await transcribeTrack({
          source: transcriptionSource.slice().buffer,
          models,
          onModelProgress: (progress) => {
            queueStepUpdate('transcription', {
              status: 'processing',
              download: toDownload(progress),
            });
          },
          onProgress: (stage, progress) => {
            queueStepUpdate('transcription', {
              status: 'processing',
              progress: fraction(progress),
              message: stage,
              download: undefined,
            });
          },
        });
        await waitForQueuedWrite();
        project = await projects.saveTranscript(project, transcript);
        project = await markDone(project, 'transcription');
      }

      for (const stepName of ['chords', 'key', 'rhythm'] as const) {
        project = await updateStep(project, stepName, {
          status: 'processing',
          progress: 0,
        });
      }
      activeStep = 'chords';
      const analysis = await analyzeTrack({
        source: source.slice().buffer,
        models,
        onStage: (stage) => {
          const stepName = getAnalysisStep(stage);
          if (stepName) {
            activeStep = stepName;
            queueStepUpdate(stepName, {
              status: 'processing',
              progress: 0,
            });
          }
        },
        onModelProgress: (progress) => {
          const stepName = getAnalysisStep(progress.label);
          if (stepName) {
            activeStep = stepName;
            queueStepUpdate(stepName, {
              status: 'processing',
              download: toDownload(progress),
            });
          }
        },
      });
      await waitForQueuedWrite();
      project = await projects.saveAnalysis(project, analysis);
      for (const stepName of ['chords', 'key', 'rhythm'] as const) {
        project = await markDone(project, stepName);
      }
      const processing = copyProcessing(project);
      processing.done = true;
      await projects.saveProcessing(project, processing);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      project = await pendingProjectWrite.catch(() => project);
      await updateStep(project, activeStep, {
        status: 'failed',
        progress: undefined,
        download: undefined,
        message: undefined,
        error: message,
      }).catch(() => undefined);
      console.error('Mobile project processing failed', error);
    } finally {
      activeProjectIds.delete(initialProject.id);
      await wakeLock?.release().catch(() => undefined);
    }
  };

  const processPending = async (): Promise<void> => {
    if (draining) {
      return;
    }
    const project = (await projects.list()).find(
      (item) =>
        !isProjectComplete(item) &&
        !hasProcessingFailure(item) &&
        !activeProjectIds.has(item.id),
    );
    if (!project) {
      return;
    }
    draining = true;
    try {
      await processProject(project);
    } finally {
      draining = false;
    }
  };

  return {
    start: () => {
      void processPending();
      const interval = window.setInterval(() => {
        void processPending();
      }, 4_000);
      return () => {
        window.clearInterval(interval);
      };
    },
  };
};
