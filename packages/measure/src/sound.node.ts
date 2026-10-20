import { analyzeHoles, analyzeSound } from './analysis/sound.es.js';
import { playFile, readWav, writeWav } from './audioFiles.node.js';
import { type MeasurePage } from './page.node.js';
import { formatSoundReport } from './report.es.js';
import { browserCaptureSchema, soundTakeSchema } from './runs.es.js';
import {
  createOutput,
  formatSetup,
  type MeasureOutput,
  type MeasureRequest,
  openCalibratedPage,
} from './session.node.js';
import { createSibilantTest } from './signals.es.js';

const signalSampleRate = 48000;
const captureMarginSeconds = 4;

const readReference = (request: MeasureRequest) =>
  request.signal === undefined
    ? {
        sampleRate: signalSampleRate,
        samples: createSibilantTest(signalSampleRate),
      }
    : readWav(request.signal);

type PlayedCapture = {
  page: MeasurePage;
  procedure: string;
  options: object;
  file: string;
  volumeDb: number;
};

const captureWhilePlaying = async (capture: PlayedCapture) => {
  const first = capture.page.logs.length;
  const pending = capture.page.callText(capture.procedure, capture.options);
  await Promise.race([capture.page.waitForLog('started', first), pending]);
  const playback = playFile(capture.file, {
    loop: false,
    volumeDb: capture.volumeDb,
  });
  await playback.finished;
  return pending;
};

const recordRuns = async (request: MeasureRequest, output: MeasureOutput) => {
  const reference = readReference(request);
  const file = output.path('signal.wav');
  writeWav(file, reference.samples, reference.sampleRate, 'float32');
  const seconds =
    reference.samples.length / reference.sampleRate + captureMarginSeconds;
  const page = await openCalibratedPage(request);
  try {
    console.log('Capturing the played file through the browser path');
    output.write(
      'browser.json',
      await captureWhilePlaying({
        page,
        procedure: 'browserCapture',
        options: { seconds },
        file,
        volumeDb: request.volumeDb,
      }),
    );
    console.log('Recording the played file into a temporary take');
    output.write(
      'app.json',
      await captureWhilePlaying({
        page,
        procedure: 'take',
        options: {
          projectId: page.projectId,
          seconds,
          startSeconds: request.startSeconds,
          songVolume: 0,
        },
        file,
        volumeDb: request.volumeDb,
      }),
    );
    console.log(`Recording a ${request.takeSeconds} s take with the song`);
    output.write(
      'holes.json',
      await page.callText('take', {
        projectId: page.projectId,
        seconds: request.takeSeconds,
        startSeconds: request.startSeconds,
        songVolume: 1,
      }),
    );
  } finally {
    page.close();
  }
};

export const runSound = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRuns(request, output);
  }
  const browser = browserCaptureSchema.parse(
    JSON.parse(output.read('browser.json')),
  );
  const app = soundTakeSchema.parse(JSON.parse(output.read('app.json')));
  const holes = soundTakeSchema.parse(JSON.parse(output.read('holes.json')));
  for (const [name, signal] of [
    ['browser', browser],
    ['app', app],
    ['holes', holes],
  ] as const) {
    writeWav(
      output.path(`${name}.wav`),
      signal.samples,
      signal.sampleRate,
      'float32',
    );
  }
  const report = [
    formatSoundReport(
      analyzeSound(readReference(request), browser, app),
      analyzeHoles(holes),
    ),
    '',
    `Browser path: ${browser.label}, ${JSON.stringify(browser.settings)}.`,
    formatSetup(app.latency),
  ].join('\n');
  output.write('report.md', `${report}\n`);
  console.log(report);
};
