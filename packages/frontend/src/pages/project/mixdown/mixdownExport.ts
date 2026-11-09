import { api } from '@musetric/api';
import { create } from 'zustand';
import { endpoints } from '../../../api/index.js';
import { saveMixdown } from './saveMixdown.js';

export type MixdownExportStage = 'preparing' | api.mixdown.Stage;

export type MixdownExport = {
  stage: MixdownExportStage;
  done?: number;
};

export type MixdownExportsState = {
  running: Partial<Record<number, MixdownExport>>;
  failed: Partial<Record<number, boolean>>;
};

export const useMixdownExports = create<MixdownExportsState>()(() => ({
  running: {},
  failed: {},
}));

const followInterval = 250;

const show = (projectId: number, progress: MixdownExport | undefined) => {
  useMixdownExports.setState((state) => ({
    running: { ...state.running, [projectId]: progress },
  }));
};

const markFailed = (projectId: number, failed: boolean) => {
  useMixdownExports.setState((state) => ({
    failed: { ...state.failed, [projectId]: failed },
  }));
};

type Report = (progress: MixdownExport) => void;

const follow = async (
  mixdownId: string,
  signal: AbortSignal,
  report: Report,
): Promise<void> => {
  const status = await endpoints.mixdown.get(mixdownId, signal);
  if (status.state === 'ready') {
    return;
  }
  if (status.state === 'failed') {
    throw new Error(status.error);
  }
  report({ stage: status.stage, done: status.done });
  await new Promise((resolve) => {
    setTimeout(resolve, followInterval);
  });
  signal.throwIfAborted();
  return follow(mixdownId, signal, report);
};

type ExportRun = {
  controller: AbortController;
  upload: AbortController;
  uploaded: boolean;
  mixdownId?: string;
};

const runs = new Map<number, ExportRun>();

export type MixdownCreation = {
  request: Omit<api.mixdown.create.Request, 'recording'>;
  renderRecording: () => Promise<File | undefined>;
  onSaved: () => void;
};

const runExport = async (
  projectId: number,
  run: ExportRun,
  creation: MixdownCreation,
  report: Report,
) => {
  const { signal } = run.controller;
  const recording = await creation.renderRecording();
  signal.throwIfAborted();
  report({ stage: 'preparing', done: 0 });
  const created = await endpoints.mixdown.create(
    projectId,
    { ...creation.request, recording },
    {
      signal: run.upload.signal,
      onUploadProgress: (event) => {
        run.uploaded = event.progress === 1;
        report({ stage: 'preparing', done: event.progress });
      },
    },
  );
  run.mixdownId = created.mixdownId;
  signal.throwIfAborted();
  await follow(created.mixdownId, signal, report);
  await saveMixdown(
    api.mixdown.content.base.endpoint({ mixdownId: created.mixdownId }),
  );
};

export const startMixdownExport = (
  projectId: number,
  creation: MixdownCreation,
) => {
  if (runs.has(projectId)) {
    return;
  }
  const run: ExportRun = {
    controller: new AbortController(),
    upload: new AbortController(),
    uploaded: false,
  };
  const { signal } = run.controller;
  runs.set(projectId, run);
  markFailed(projectId, false);
  const report: Report = (progress) => {
    if (!signal.aborted) {
      show(projectId, progress);
    }
  };
  report({ stage: 'preparing' });
  void runExport(projectId, run, creation, report)
    .then(() => {
      if (!signal.aborted) {
        creation.onSaved();
      }
    })
    .catch((error: unknown) => {
      if (!signal.aborted) {
        console.error('Failed to export the mix', error);
        markFailed(projectId, true);
        return;
      }
      if (run.mixdownId !== undefined) {
        void endpoints.mixdown
          .remove(run.mixdownId)
          .catch((failure: unknown) => {
            console.error('Failed to cancel the export', failure);
          });
      }
    })
    .finally(() => {
      if (runs.get(projectId) === run) {
        runs.delete(projectId);
        show(projectId, undefined);
      }
    });
};

export const cancelMixdownExport = (projectId: number) => {
  const run = runs.get(projectId);
  if (!run) {
    return;
  }
  runs.delete(projectId);
  run.controller.abort();
  if (!run.uploaded) {
    run.upload.abort();
  }
  show(projectId, undefined);
};
