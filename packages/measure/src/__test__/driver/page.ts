import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { type MeasureInput } from '../measureInput.js';
import { bundleInjectedScript } from './bundle.js';
import { connectPage, type MeasureLog } from './cdp.js';
import { type MeasureDevice, openDevicePage } from './device.js';
import { createPageInput } from './input.js';

const readStep = 1_000_000;
const logPollMs = 50;

export type MeasurePage = {
  projectId: number;
  callText: (procedure: string, options: object) => Promise<string>;
  logs: MeasureLog[];
  waitForLog: (channel: string, after: number) => Promise<MeasureLog>;
  input: (input: MeasureInput) => Promise<void>;
  finishInput: (id: number) => Promise<void>;
  reload: () => Promise<void>;
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
    input: createPageInput(page.send, device.kind),
    finishInput: async (id) => {
      await page.evaluate(`musetricMeasure.inputDone(${id})`);
    },
    reload: async () => {
      await page.evaluate('setTimeout(() => location.reload(), 0)');
    },
    close: () => {
      page.close();
      target.close();
    },
  };
};
