import { type BrowserJobContext } from './browserJob.js';
import { fetchOk } from './browserShared.js';

const reportIntervalMs = 100;

export type ReportLoading = (loaded: number, total: number) => void;

export const fetchModelFiles = async (
  urls: string[],
  report: ReportLoading,
): Promise<Uint8Array<ArrayBuffer>[]> => {
  const responses = await Promise.all(
    urls.map(async (url) => fetchOk(url, 'a model file')),
  );
  const lengths = responses.map((response) =>
    Number(response.headers.get('content-length')),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const progress = { loaded: 0 };
  report(0, total);
  return Promise.all(
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
        report(progress.loaded, total);
      }
      return bytes;
    }),
  );
};

export const loadModel = async <Runtime>(
  context: BrowserJobContext,
  load: (report: ReportLoading) => Promise<Runtime>,
): Promise<Runtime> => {
  const progress = { building: false, sentAt: -Infinity };
  const runtime = await load((loaded, total) => {
    if (progress.building) {
      return;
    }
    if (loaded >= total) {
      progress.building = true;
      context.reportBuilding();
      return;
    }
    const now = performance.now();
    if (now - progress.sentAt < reportIntervalMs) {
      return;
    }
    progress.sentAt = now;
    context.reportLoading({ loaded, total });
  });
  context.reportLoaded();
  return runtime;
};
