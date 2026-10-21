import { analyzeTiming } from '../analysis/timing.js';
import { formatTimingTable } from '../report.js';
import { timingRunSchema } from '../runs.js';
import {
  createOutput,
  formatSetup,
  type MeasureOutput,
  type MeasureRequest,
  openCalibratedPage,
} from './session.js';

const getRunName = (tempo: number) => `timing-${tempo}.json`;

const recordRuns = async (request: MeasureRequest, output: MeasureOutput) => {
  const page = await openCalibratedPage(request);
  try {
    for (const tempo of request.tempos) {
      console.log(`Recording a ${request.seconds} s take at tempo ${tempo}`);
      output.write(
        getRunName(tempo),
        await page.callText('timing', {
          projectId: page.projectId,
          seconds: request.seconds,
          tempo,
        }),
      );
    }
  } finally {
    page.close();
  }
};

export const runTiming = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRuns(request, output);
  }
  const runs = request.tempos.map((tempo) =>
    timingRunSchema.parse(JSON.parse(output.read(getRunName(tempo)))),
  );
  const report = [
    formatTimingTable(runs.map(analyzeTiming)),
    '',
    formatSetup(runs[0].latencyDuring ?? runs[0].latency),
  ].join('\n');
  output.write('report.md', `${report}\n`);
  console.log(report);
};
