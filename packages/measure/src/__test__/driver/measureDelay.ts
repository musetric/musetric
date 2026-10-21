import { z } from 'zod';
import { analyzeDelay, type DelayTake } from '../analysis/delay.js';
import { formatDelayTable } from '../report.js';
import { delayRunSchema, parseEdgeLog } from '../runs.js';
import { createVowelTone } from '../signals.js';
import { playFile, writeWav } from './audioFiles.js';
import {
  createOutput,
  formatSetup,
  type MeasureOutput,
  type MeasureRequest,
  openCalibratedPage,
} from './session.js';

const views = ['notes', 'spectrum'] as const;
const signalSampleRate = 48000;

const edgeListSchema = z.array(z.array(z.unknown()));

type DelayView = (typeof views)[number];

const getRunName = (view: DelayView) => `delay-${view}.json`;
const getEdgesName = (view: DelayView) => `edges-${view}.json`;

const prepareSignal = (request: MeasureRequest, output: MeasureOutput) => {
  if (request.signal !== undefined) {
    return request.signal;
  }
  const path = output.path('vowel.wav');
  writeWav(path, createVowelTone(signalSampleRate), signalSampleRate, 'pcm16');
  return path;
};

const recordRuns = async (request: MeasureRequest, output: MeasureOutput) => {
  const page = await openCalibratedPage(request);
  const playback = playFile(prepareSignal(request, output), {
    loop: true,
    volumeDb: request.volumeDb,
  });
  try {
    for (const view of views) {
      console.log(`Recording a ${request.seconds} s take in the ${view} view`);
      const first = page.logs.length;
      output.write(
        getRunName(view),
        await page.callText('delay', {
          projectId: page.projectId,
          seconds: request.seconds,
          startSeconds: request.startSeconds,
          view,
        }),
      );
      const edges = page.logs
        .slice(first)
        .filter((log) => log.channel === 'edge')
        .map((log) => log.values);
      output.write(getEdgesName(view), JSON.stringify(edges));
    }
  } finally {
    playback.stop();
    page.close();
  }
};

const readTake = (output: MeasureOutput, view: DelayView): DelayTake => ({
  run: delayRunSchema.parse(JSON.parse(output.read(getRunName(view)))),
  edges: edgeListSchema
    .parse(JSON.parse(output.read(getEdgesName(view))))
    .map(parseEdgeLog),
});

export const runDelay = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRuns(request, output);
  }
  const notes = readTake(output, 'notes');
  const report = [
    formatDelayTable(analyzeDelay(notes, readTake(output, 'spectrum'))),
    '',
    formatSetup(notes.run.latencyDuring ?? notes.run.latency),
  ].join('\n');
  output.write('report.md', `${report}\n`);
  console.log(report);
};
