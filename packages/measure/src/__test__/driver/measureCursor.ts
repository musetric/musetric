import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { analyzeCursor } from '../analysis/cursor.js';
import { formatCursorTable } from '../report.js';
import { calibrationSchema, cursorRunSchema } from '../runs.js';
import { type MeasureLog } from './cdp.js';
import { measureInputSchema } from './input.js';
import { type MeasurePage, openMeasurePage } from './page.js';
import {
  createOutput,
  formatSetup,
  type MeasureOutput,
  type MeasureRequest,
} from './session.js';

const runName = 'cursor.json';
const latencyName = 'latency.json';

const readDrawn = (logs: readonly MeasureLog[]) =>
  logs
    .filter((log) => log.channel === 'drawn')
    .map((log) => log.values.map(Number));

const inputPollMs = 10;

const serveInputs = (page: MeasurePage, firstLog: number) => {
  const served = new Set<number>();
  const stopped = new AbortController();
  const serve = async () => {
    while (!stopped.signal.aborted) {
      for (const log of page.logs.slice(firstLog)) {
        if (log.channel !== 'input') {
          continue;
        }
        const [id, text] = log.values;
        const inputId = z.number().parse(id);
        if (served.has(inputId)) {
          continue;
        }
        served.add(inputId);
        await page.input(
          measureInputSchema.parse(JSON.parse(z.string().parse(text))),
        );
        await page.finishInput(inputId);
      }
      await setTimeout(inputPollMs);
    }
  };
  const done = serve();
  return async () => {
    stopped.abort();
    await done;
  };
};

const recordRun = async (request: MeasureRequest, output: MeasureOutput) => {
  const page = await openMeasurePage(request.device);
  try {
    console.log(
      `Running the cursor's events ${request.cycles} times from ${request.startSeconds} s`,
    );
    const firstLog = page.logs.length;
    const stopServing = serveInputs(page, firstLog);
    const text = await page
      .callText('cursor', {
        cycles: request.cycles,
        startSeconds: request.startSeconds,
      })
      .finally(stopServing);
    const run = cursorRunSchema.parse(JSON.parse(text));
    const from = run.frames.at(0)?.[0] ?? 0;
    const to = run.frames.at(-1)?.[0] ?? 0;
    const drawn = cursorRunSchema.shape.drawn.parse(
      readDrawn(page.logs.slice(firstLog)).filter(
        (entry) => entry[0] >= from && entry[0] <= to,
      ),
    );
    output.write(runName, JSON.stringify({ ...run, drawn }));
    output.write(latencyName, await page.callText('latency', {}));
  } finally {
    page.close();
  }
};

export const runCursor = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRun(request, output);
  }
  const run = cursorRunSchema.parse(JSON.parse(output.read(runName)));
  const latency = calibrationSchema.shape.latency.parse(
    JSON.parse(output.read(latencyName)),
  );
  const report = [
    formatCursorTable(analyzeCursor(run)),
    '',
    formatSetup(latency),
  ].join('\n');
  output.write('report.md', `${report}\n`);
  console.log(report);
};
