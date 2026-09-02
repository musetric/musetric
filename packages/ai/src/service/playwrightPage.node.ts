import { chromium } from 'playwright';
import { type OpenJobPage } from './openJobPage.js';

const browserLaunchArgs = [
  '--enable-unsafe-webgpu',
  '--disable-webgpu-blocklist',
  '--ignore-gpu-blocklist',
  '--force_high_performance_gpu',
];

export const openPlaywrightPage: OpenJobPage = async (url: string) => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: browserLaunchArgs,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    return { close: async () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
};
