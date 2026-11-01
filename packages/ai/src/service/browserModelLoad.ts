import { type BrowserJobContext } from './browserJob.js';
import { fetchOk } from './browserShared.js';

const reportIntervalMs = 100;

export type ModelLoadReport = {
  loading: (loaded: number, total: number) => void;
  building: () => void;
};

export const fetchModelFiles = async (
  urls: string[],
  report: ModelLoadReport,
): Promise<Uint8Array<ArrayBuffer>[]> => {
  const responses = await Promise.all(
    urls.map(async (url) => fetchOk(url, 'a model file')),
  );
  const lengths = responses.map((response) =>
    Number(response.headers.get('content-length')),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const progress = { loaded: 0 };
  report.loading(0, total);
  const files = await Promise.all(
    responses.map(async (response, index) => {
      const bytes = new Uint8Array(lengths[index]);
      if (!response.body) {
        throw new Error('A model file has no body');
      }
      const reader = response.body.getReader();
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes.set(value, offset);
        offset += value.length;
        progress.loaded += value.length;
        report.loading(progress.loaded, total);
      }
      return bytes;
    }),
  );
  report.building();
  return files;
};

export const releaseModelFiles = (files: Uint8Array<ArrayBuffer>[]): void => {
  for (const file of files) {
    file.buffer.transfer(0);
  }
};

export const loadModelFilesInTurn = async <Loaded>(
  groups: string[][],
  report: ModelLoadReport,
  create: (files: Uint8Array<ArrayBuffer>[], index: number) => Promise<Loaded>,
): Promise<Loaded[]> => {
  const lengths = await Promise.all(
    groups.flat().map(async (url) => {
      const response = await fetchOk(url, 'a model file', { method: 'HEAD' });
      return Number(response.headers.get('content-length'));
    }),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const progress = { done: 0 };
  const loaded: Loaded[] = [];
  for (const [index, group] of groups.entries()) {
    const files = await fetchModelFiles(group, {
      loading: (part) => {
        report.loading(progress.done + part, total);
      },
      building: report.building,
    });
    progress.done += files.reduce((sum, file) => sum + file.byteLength, 0);
    loaded.push(await create(files, index));
    releaseModelFiles(files);
  }
  return loaded;
};

export const loadModel = async <Runtime>(
  context: BrowserJobContext,
  load: (report: ModelLoadReport) => Promise<Runtime>,
): Promise<Runtime> => {
  const progress = { sentAt: -Infinity };
  const runtime = await load({
    loading: (loaded, total) => {
      const now = performance.now();
      if (now - progress.sentAt < reportIntervalMs) {
        return;
      }
      progress.sentAt = now;
      context.reportLoading({ loaded, total });
    },
    building: () => {
      progress.sentAt = -Infinity;
      context.reportBuilding();
    },
  });
  context.reportLoaded();
  return runtime;
};
