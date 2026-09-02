import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type OpenedPage, type OpenJobPage } from '../jobGpuPage.node.js';
import { jobUrlParameter } from '../jobProtocol.js';

export type Workspace = {
  path: (name: string) => string;
  remove: () => void;
};

export const createWorkspace = (): Workspace => {
  const root = mkdtempSync(join(tmpdir(), 'musetric-jobs-'));
  return {
    path: (name) => join(root, name),
    remove: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};

export const openWith = (connect: (jobUrl: string) => void): OpenJobPage => {
  const closed: OpenedPage = { close: async () => Promise.resolve() };
  return async (url) => {
    const jobUrl = new URL(url).searchParams.get(jobUrlParameter) ?? undefined;
    if (jobUrl === undefined) {
      throw new Error('the page url should carry the job socket url');
    }
    connect(jobUrl);
    return Promise.resolve(closed);
  };
};
