import { analyzeSeek } from '../analysis/seek.js';
import { formatSeekTable } from '../report.js';
import { seekRunSchema } from '../runs.js';
import { openMeasurePage } from './page.js';
import {
  createOutput,
  type MeasureOutput,
  type MeasureRequest,
} from './session.js';

const runName = 'seek.json';
const masterContent = /\/master\/(lead|backing|instrumental)\/content/;
const pageRunSchema = seekRunSchema.omit({ requests: true });
const stemSchema = seekRunSchema.shape.requests.element.shape.stem;

const recordRun = async (request: MeasureRequest, output: MeasureOutput) => {
  const page = await openMeasurePage(request.device, true);
  try {
    const decoy =
      request.doubleMs > 0
        ? `, each ${request.doubleMs} ms after a seek to another far frame`
        : '';
    console.log(
      `Seeking ${request.seeks} times to far frames while playing, seed ${request.seed}${decoy}`,
    );
    const run = pageRunSchema.parse(
      JSON.parse(
        await page.callText('seek', {
          seeks: request.seeks,
          seed: request.seed,
          startSeconds: request.startSeconds,
          doubleMs: request.doubleMs,
        }),
      ),
    );
    const requests = page.requests().flatMap((found) => {
      const stem = masterContent.exec(found.url)?.[1];
      return stem === undefined
        ? []
        : [
            {
              stem: stemSchema.parse(stem),
              sentAt: found.sentAt,
              endedAt: found.endedAt,
              failed: found.failed,
            },
          ];
    });
    output.write(runName, JSON.stringify({ ...run, requests }));
  } finally {
    page.close();
  }
};

export const runSeek = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRun(request, output);
  }
  const run = seekRunSchema.parse(JSON.parse(output.read(runName)));
  const report = formatSeekTable(analyzeSeek(run));
  output.write('report.md', `${report}\n`);
  console.log(report);
};
