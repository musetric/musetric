import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import {
  type FailureRun,
  failureRunSchema,
  recoveryRunSchema,
} from '../runs.js';
import { openMeasurePage } from './page.js';
import {
  createOutput,
  type MeasureOutput,
  type MeasureRequest,
} from './session.js';

const runName = 'failure.json';
const recoveryName = 'recovery.json';
const faults = ['caught', 'uncaught'] as const;
const reloadSettleMs = 3000;

const runPage = async <Value>(
  request: MeasureRequest,
  step: (page: Awaited<ReturnType<typeof openMeasurePage>>) => Promise<Value>,
): Promise<Value> => {
  const page = await openMeasurePage(request.device);
  try {
    return await step(page);
  } finally {
    page.close();
  }
};

const recordRuns = async (request: MeasureRequest, output: MeasureOutput) => {
  const runs: unknown[] = [];
  for (const fault of faults) {
    console.log(
      `Recording a take from ${request.startSeconds} s and throwing a ${fault} fault in the player after ${request.seconds} s`,
    );
    runs.push(
      await runPage(request, async (page) => {
        const run: unknown = JSON.parse(
          await page.callText('failure', {
            projectId: page.projectId,
            fault,
            startSeconds: request.startSeconds,
            faultSeconds: request.seconds,
          }),
        );
        await page.reload();
        return run;
      }),
    );
    await setTimeout(reloadSettleMs);
  }
  output.write(runName, JSON.stringify(runs));
  output.write(
    recoveryName,
    await runPage(request, async (page) => page.callText('recovery', {})),
  );
};

const formatMs = (value: number | undefined) =>
  value === undefined ? 'never' : `${Math.round(value)} ms`;

const formatRun = (run: FailureRun) => {
  const toMs = (frameCount: number) => (frameCount / run.sampleRate) * 1000;
  const expectedMs = run.faultSeconds * 1000 - toMs(run.latencyFrameCount);
  const hostMs = toMs(run.hostFrameCount);
  return `| ${run.fault} | ${formatMs(run.failedMs)} | ${formatMs(run.stoppedMs)} | ${formatMs(run.takeEndedMs)} | ${formatMs(run.noticeMs)} | ${Math.round(toMs(run.cursorDriftFrames))} ms | ${(hostMs / 1000).toFixed(3)} s | ${Math.round(expectedMs - hostMs)} ms |`;
};

export const runFailure = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRuns(request, output);
  }
  const runs = z
    .array(failureRunSchema)
    .parse(JSON.parse(output.read(runName)));
  const recovery = recoveryRunSchema.parse(
    JSON.parse(output.read(recoveryName)),
  );
  const report = [
    '| Fault | Reported | Stopped | Take ended | Notice | Cursor after | Take on host | Short of the fault |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...runs.map(formatRun),
    '',
    `After a reload the player is ${recovery.player} and plays ${Math.round((recovery.playedFrames / recovery.sampleRate) * 1000)} ms of the song in 1 s.`,
  ].join('\n');
  output.write('report.md', `${report}\n`);
  console.log(report);
};
