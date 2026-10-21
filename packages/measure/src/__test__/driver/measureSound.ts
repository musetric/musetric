import {
  analyzeHoles,
  analyzeSound,
  type SoundSignal,
} from '../analysis/sound.js';
import { formatHoles, formatSoundReport } from '../report.js';
import {
  browserCaptureSchema,
  calibrationSchema,
  soundTakeSchema,
} from '../runs.js';
import { createSibilantTest } from '../signals.js';
import { playFile, readWav, writeWav } from './audioFiles.js';
import { type MeasurePage } from './page.js';
import {
  createOutput,
  formatSetup,
  type MeasureOutput,
  type MeasureRequest,
  openCalibratedPage,
} from './session.js';

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

type FileRun = {
  file: string;
  seconds: number;
};

const prepareFileRun = async (
  request: MeasureRequest,
  output: MeasureOutput,
  page: MeasurePage,
): Promise<FileRun> => {
  const latency = calibrationSchema.shape.latency.parse(
    JSON.parse(await page.callText('latency', {})),
  );
  if (request.device.kind === 'android' && latency.outputKind === 'bluetooth') {
    throw new Error(
      'Turn Bluetooth off for the file comparison: with a headset connected the WebView records the headset microphone and keeps the call route. Use --take-only to record only the long take',
    );
  }
  const reference = readReference(request);
  const file = output.path('signal.wav');
  writeWav(file, reference.samples, reference.sampleRate, 'float32');
  return {
    file,
    seconds:
      reference.samples.length / reference.sampleRate + captureMarginSeconds,
  };
};

const recordRuns = async (request: MeasureRequest, output: MeasureOutput) => {
  const page = await openCalibratedPage(request);
  try {
    const fileRun = request.takeOnly
      ? undefined
      : await prepareFileRun(request, output, page);
    if (fileRun) {
      console.log('Recording the played file into a temporary take');
      output.write(
        'app.json',
        await captureWhilePlaying({
          page,
          procedure: 'take',
          options: {
            projectId: page.projectId,
            seconds: fileRun.seconds,
            startSeconds: request.startSeconds,
            songVolume: 0,
          },
          file: fileRun.file,
          volumeDb: request.volumeDb,
        }),
      );
    }
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
    if (fileRun) {
      console.log('Capturing the played file through the browser path');
      output.write(
        'browser.json',
        await captureWhilePlaying({
          page,
          procedure: 'browserCapture',
          options: { seconds: fileRun.seconds },
          file: fileRun.file,
          volumeDb: request.volumeDb,
        }),
      );
      if (request.device.kind === 'android') {
        console.log(
          'The WebView keeps the call route after the browser path: restart the app before the next measurement',
        );
      }
    }
  } finally {
    page.close();
  }
};

const writeListening = (
  output: MeasureOutput,
  name: string,
  signal: SoundSignal,
) => {
  writeWav(
    output.path(`${name}.wav`),
    signal.samples,
    signal.sampleRate,
    'float32',
  );
};

const reportFileRuns = (request: MeasureRequest, output: MeasureOutput) => {
  const browser = browserCaptureSchema.parse(
    JSON.parse(output.read('browser.json')),
  );
  const app = soundTakeSchema.parse(JSON.parse(output.read('app.json')));
  writeListening(output, 'browser', browser);
  writeListening(output, 'app', app);
  return [
    formatSoundReport(analyzeSound(readReference(request), browser, app)),
    '',
    `Browser path: ${browser.label || 'default'}, ${JSON.stringify(browser.settings)}.`,
  ];
};

export const runSound = async (request: MeasureRequest) => {
  const output = createOutput(request.outDir);
  if (!request.reanalyze) {
    await recordRuns(request, output);
  }
  const holes = soundTakeSchema.parse(JSON.parse(output.read('holes.json')));
  writeListening(output, 'holes', holes);
  const report = [
    ...(request.takeOnly ? [] : reportFileRuns(request, output)),
    formatHoles(analyzeHoles(holes), request.takeSeconds),
    '',
    formatSetup(holes.latency),
  ].join('\n');
  output.write('report.md', `${report}\n`);
  console.log(report);
};
