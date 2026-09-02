import { type OpenJobPage } from './openJobPage.js';

export type GpuHost = {
  openPage: OpenJobPage;
};

export const defaultOpenJobPage: OpenJobPage = async (url: string) => {
  const { openPlaywrightPage } = await import('./playwrightPage.node.js');
  return openPlaywrightPage(url);
};
