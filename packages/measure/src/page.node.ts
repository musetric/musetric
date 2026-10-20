import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { connectPage, type MeasureLog } from './cdp.node.js';
import { type MeasureDevice, openDevicePage } from './device.node.js';

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
  const target = await openDevicePage(device);
  const page = await connectPage(target.webSocketUrl);
  const ready = await page.evaluate("typeof musetricMeasure === 'object'");
  if (ready !== true) {
    page.close();
    target.close();
    throw new Error(
      'The page has no measure entry: build Musetric with frontendMeasure=true',
    );
  }
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
