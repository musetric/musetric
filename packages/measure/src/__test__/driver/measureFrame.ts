import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import { z } from 'zod';
import {
  analyzeFrameParts,
  analyzeScreens,
  type FramePhase,
} from '../analysis/frame.js';
import {
  findThumbProgress,
  type GrayScreen,
  type ScreenBox,
  toGrayScreen,
} from '../analysis/screen.js';
import { formatFrameReport } from '../report.js';
import { type FrameRun, frameRunSchema } from '../runs.js';
import { type MeasureDevice } from './device.js';
import { type MeasurePage, openMeasurePage } from './page.js';
import {
  createOutput,
  type MeasureOutput,
  type MeasureRequest,
} from './session.js';

const views = ['notes', 'spectrum'] as const;
const phases: readonly FramePhase[] = ['playing', 'drag'];
const playSeconds = 2.5;
const swipeMs = 4000;
const swipeFrom = 0.055;
const swipeTo = 0.945;
const afterSwipeMs = 1500;
const thumbRadius = 6;
const controlSeconds = 0.3;
const capturePath = '/data/local/tmp/musetric-frame';
const webViewPattern = /RustWebView\{[^}]* -?\d+,(-?\d+)-\d+,\d+/;

const boxSchema = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
});

const startSchema = z.object({
  sampleRate: z.number(),
  frameCount: z.number(),
  playedAt: z.number(),
  layout: z.object({
    pixelRatio: z.number(),
    spectrogram: boxSchema,
    ruler: boxSchema,
    rail: boxSchema,
  }),
});

const frameLogSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.string(),
]);

const metricsSchema = z.record(z.string(), z.number());

const runFile = promisify(execFile);

const adb = async (device: MeasureDevice, args: string[]) => {
  const result = await runFile(
    'adb',
    device.serial === undefined ? args : ['-s', device.serial, ...args],
    { encoding: 'buffer', maxBuffer: 1 << 27 },
  );
  return result.stdout;
};

const readWebViewTop = async (device: MeasureDevice) => {
  const hierarchy = String(
    await adb(device, ['shell', 'dumpsys', 'activity', 'top']),
  );
  const top = webViewPattern.exec(hierarchy)?.[1];
  if (top === undefined) {
    throw new Error('The phone shows no WebView of Musetric');
  }
  return Number(top);
};

const writeScreen = (
  output: MeasureOutput,
  name: string,
  screen: GrayScreen,
) => {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(screen.width, 0);
  header.writeUInt32LE(screen.height, 4);
  writeFileSync(
    output.path(`${name}.gray`),
    deflateSync(Buffer.concat([header, screen.pixels])),
  );
};

const readScreen = (output: MeasureOutput, name: string): GrayScreen => {
  const bytes = inflateSync(readFileSync(output.path(`${name}.gray`)));
  return {
    width: bytes.readUInt32LE(0),
    height: bytes.readUInt32LE(4),
    pixels: new Uint8Array(bytes.subarray(8)),
  };
};

type View = (typeof views)[number];

const getRunName = (view: View, cycle: number) => `frame-${view}-${cycle}.json`;

const swipeWithCaptures = async (
  device: MeasureDevice,
  points: readonly number[],
) => {
  const swipe = [...points, swipeMs].map((value) => String(Math.round(value)));
  const count = Number(
    String(
      await adb(device, [
        'shell',
        `input swipe ${swipe.join(' ')} & swiping=$!; count=0; while kill -0 $swiping 2>/dev/null; do screencap ${capturePath}-$count.raw; count=$((count+1)); done; echo $count`,
      ]),
    ).trim(),
  );
  const screens: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    screens.push(
      await adb(device, ['exec-out', 'cat', `${capturePath}-${index}.raw`]),
    );
  }
  await adb(device, ['shell', `rm -f ${capturePath}-*.raw`]);
  return screens;
};

type FrameSession = {
  page: MeasurePage;
  request: MeasureRequest;
  output: MeasureOutput;
};

const recordRun = async (
  session: FrameSession,
  view: View,
  cycle: number,
): Promise<FrameRun> => {
  const { page, request, output } = session;
  const { device } = request;
  const android = device.kind === 'android';
  const first = page.logs.length;
  const start = startSchema.parse(
    JSON.parse(
      await page.callText('frameStart', {
        view,
        startSeconds: request.startSeconds,
        playSeconds,
      }),
    ),
  );
  const { pixelRatio, spectrogram, ruler, rail } = start.layout;
  const offset = android ? await readWebViewTop(device) : 0;
  const top = offset + Math.floor(spectrogram.top * pixelRatio);
  const bottom =
    offset + Math.ceil((rail.top + rail.height + thumbRadius) * pixelRatio);
  const toScreenBox = (box: z.infer<typeof boxSchema>): ScreenBox => ({
    left: Math.round(box.left * pixelRatio),
    top: offset + Math.round(box.top * pixelRatio) - top,
    width: Math.round(box.width * pixelRatio),
    height: Math.round(box.height * pixelRatio),
  });
  const boxes = {
    spectrogram: toScreenBox(spectrogram),
    ruler: toScreenBox(ruler),
    rail: toScreenBox(rail),
  };
  const from = rail.left + rail.width * swipeFrom;
  const to = rail.left + rail.width * swipeTo;
  const y = rail.top + rail.height / 2;
  const swipeStartedAt = z
    .number()
    .parse(JSON.parse(await page.callText('now', {})));
  const captured = android
    ? await swipeWithCaptures(
        device,
        [from, offset / pixelRatio + y, to, offset / pixelRatio + y].map(
          (value) => value * pixelRatio,
        ),
      )
    : await page
        .input({ kind: 'swipe', fromX: from, toX: to, y, durationMs: swipeMs })
        .then(() => []);
  await setTimeout(afterSwipeMs);
  const held = z
    .array(z.tuple([z.number(), z.number()]))
    .parse(JSON.parse(await page.callText('frameStop', {})));
  const frames = page.logs
    .slice(first)
    .filter((log) => log.channel === 'frame')
    .map((log) => {
      const values = frameLogSchema.parse(log.values);
      return {
        startedAt: values[0],
        submittedAt: values[1],
        doneAt: values[2],
        playing: values[3] === 1,
        playheadFrame: values[4],
        metrics: metricsSchema.parse(JSON.parse(values[5])),
      };
    });

  const capture = async (name: string) => {
    const screen = toGrayScreen(
      await adb(device, ['exec-out', 'screencap']),
      top,
      bottom,
    );
    writeScreen(output, name, screen);
  };
  const show = async (frameIndex: number) =>
    z.number().parse(
      JSON.parse(
        await page.callText('frameShow', {
          frameIndex: Math.round(
            Math.min(start.frameCount - 1, Math.max(0, frameIndex)),
          ),
        }),
      ),
    );
  const screens: FrameRun['screens'] = [];
  for (const [index, raw] of captured.entries()) {
    const name = `${view}-${cycle}-${index}`;
    const screen = toGrayScreen(raw, top, bottom);
    writeScreen(output, name, screen);
    const progress = findThumbProgress(
      screen,
      boxes.rail,
      thumbRadius * pixelRatio,
    );
    const referenceFrame = await show(progress * start.frameCount);
    await capture(`${name}-reference`);
    screens.push({
      name,
      progress,
      reference: `${name}-reference`,
      referenceFrame,
    });
  }
  const base = screens.at(0);
  const control = base && {
    base: base.reference,
    baseFrame: base.referenceFrame,
    reference: `${view}-${cycle}-control`,
    frame: await show(
      base.referenceFrame + Math.round(controlSeconds * start.sampleRate),
    ),
  };
  if (control) {
    await capture(control.reference);
  }
  return {
    view,
    cycle,
    sampleRate: start.sampleRate,
    frameCount: start.frameCount,
    playedAt: start.playedAt,
    swipeStartedAt,
    held,
    frames,
    boxes,
    screens,
    control,
  };
};

const recordRuns = async (request: MeasureRequest, output: MeasureOutput) => {
  const page = await openMeasurePage(request.device);
  try {
    for (const view of views) {
      for (let cycle = 0; cycle < request.cycles; cycle += 1) {
        console.log(
          `Playing and swiping the progress bar in the ${view} view, ${cycle + 1} of ${request.cycles}`,
        );
        const run = await recordRun({ page, request, output }, view, cycle);
        output.write(getRunName(view, cycle), JSON.stringify(run));
      }
    }
  } finally {
    page.close();
  }
};

export const runFrame = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRuns(request, output);
  }
  const runs = views.flatMap((view) =>
    Array.from({ length: request.cycles }, (_, cycle) =>
      frameRunSchema.parse(JSON.parse(output.read(getRunName(view, cycle)))),
    ),
  );
  const report = formatFrameReport(
    views.flatMap((view) =>
      phases.map((phase) => analyzeFrameParts(runs, view, phase)),
    ),
    runs.map((run) => ({
      view: run.view,
      cycle: run.cycle,
      result: analyzeScreens({
        run,
        read: (name) => readScreen(output, name),
      }),
    })),
  );
  output.write('report.md', `${report}\n`);
  console.log(report);
};
