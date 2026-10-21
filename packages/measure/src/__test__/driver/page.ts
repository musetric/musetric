import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { bundleInjectedScript } from './bundle.js';
import { connectPage, type MeasureLog } from './cdp.js';
import { type MeasureDevice, openDevicePage } from './device.js';

const readStep = 1_000_000;
const logPollMs = 50;

export type MeasurePage = {
  projectId: number;
  callText: (procedure: string, options: object) => Promise<string>;
  logs: MeasureLog[];
  waitForLog: (channel: string, after: number) => Promise<MeasureLog>;
  close: () => void;
};

export const openMeasurePage = async (
  device: MeasureDevice,
): Promise<MeasurePage> => {
  const [pageScript, workerScript] = await Promise.all([
    bundleInjectedScript('page'),
    bundleInjectedScript('spectrogramWorker'),
  ]);
  const target = await openDevicePage(device);
  const page = await connectPage(target.webSocketUrl, {
    urlPart: 'spectrogram.worker',
    code: workerScript,
  });
  const ready = await page.evaluate("typeof musetricMeasureHooks === 'object'");
  if (ready !== true) {
    page.close();
    target.close();
    throw new Error(
      'The page has no measure hooks: build Musetric with frontendMeasure=true',
    );
  }
  await page.evaluate(pageScript);
  return {
    projectId: target.projectId,
    callText: async (procedure, options) => {
      const length = z
        .number()
        .parse(
          await page.evaluate(
            `musetricMeasure.keep(musetricMeasure.${procedure}(${JSON.stringify(options)}))`,
          ),
        );
      let text = '';
      for (let start = 0; start < length; start += readStep) {
        text += z
          .string()
          .parse(
            await page.evaluate(`musetricMeasure.read(${start}, ${readStep})`),
          );
      }
      return text;
    },
    logs: page.logs,
    waitForLog: async (channel, after) => {
      for (;;) {
        const log = page.logs
          .slice(after)
          .find((entry) => entry.channel === channel);
        if (log) {
          return log;
        }
        await setTimeout(logPollMs);
      }
    },
    close: () => {
      page.close();
      target.close();
    },
  };
};
