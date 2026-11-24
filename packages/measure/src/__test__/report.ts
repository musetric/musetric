import { type CursorResult } from './analysis/cursor.js';
import { type DelayResult } from './analysis/delay.js';
import {
  bandCenters,
  type HoleResult,
  type SoundResult,
} from './analysis/sound.js';
import { type TimingResult } from './analysis/timing.js';
import { type Spread } from './dsp/stats.js';
import { type PageLatency } from './runs.js';

const minus = '−';

export const formatSigned = (value: number, digits: number) => {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) {
    return text;
  }
  return value < 0 ? `${minus}${text}` : `+${text}`;
};

const formatNumber = (value: number, digits: number) =>
  value < 0
    ? `${minus}${Math.abs(value).toFixed(digits)}`
    : value.toFixed(digits);

const formatSignedSpread = (spread: Spread) =>
  spread.count === 0
    ? 'none'
    : `${formatSigned(spread.median, 1)} ms (${formatSigned(spread.p10, 1)}…${formatSigned(spread.p90, 1)})`;

const formatSpread = (spread: Spread) =>
  spread.count === 0
    ? 'none'
    : `${formatNumber(spread.median, 0)} ms (${formatNumber(spread.p10, 0)}…${formatNumber(spread.p90, 0)})`;

const toMs = (frameCount: number, sampleRate: number) =>
  Math.round((frameCount / sampleRate) * 1000);

export const formatLatency = (latency: PageLatency) => {
  const { sampleRate } = latency;
  const parts = [
    `latency ${latency.latencySource}`,
    `output reported ${toMs(latency.reportedOutputFrameCount, sampleRate)} ms, measured ${toMs(latency.outputFrameCount, sampleRate)} ms`,
    `recording ${toMs(latency.recordingFrameCount, sampleRate)} ms`,
  ];
  if (latency.timedRoundTripFrameCount !== undefined) {
    parts.push(
      `round trip ${toMs(latency.timedRoundTripFrameCount, sampleRate)} ms`,
    );
  }
  parts.push(
    `output ${latency.outputLabel ?? latency.outputKind}, input ${latency.inputLabel ?? 'default'}`,
  );
  return parts.join('; ');
};

export const formatTimingTable = (results: readonly TimingResult[]) =>
  [
    '| Tempo | Heard clicks | Playhead against the heard click | Take against the beats |',
    '| --- | ---: | ---: | ---: |',
    ...results.map(
      (result) =>
        `| ${result.tempo} | ${result.heardClickCount} | ${formatSignedSpread(result.playhead)}, ${result.playhead.count} matched | ${formatSignedSpread(result.take)}, ${result.take.count} matched |`,
    ),
  ].join('\n');

export const formatDelayTable = (result: DelayResult) => {
  const { arrivals } = result;
  const roundTrip =
    result.roundTripMs === undefined
      ? 'none'
      : `${Math.round(result.roundTripMs)} ms`;
  return [
    '| Voice line behind the playhead | Spectrogram behind the playhead | Newest audio behind the playhead | Microphone chunks to the page, p50 / p99 / max | Round trip of the timed microphone | Output delay, reported / measured |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${formatSpread(result.line)} | ${formatSpread(result.spectrum)} | ${formatSpread(result.audio)} | ${arrivals.p50.toFixed(1)} / ${arrivals.p99.toFixed(1)} / ${arrivals.max.toFixed(1)} ms | ${roundTrip} | ${Math.round(result.reportedOutputMs)} / ${Math.round(result.outputMs)} ms |`,
    '',
    `Frames with a line: ${result.line.count} of ${result.renderCount}; render ${formatSpread(result.renderMs)}; latency ${result.latencySource}.`,
  ].join('\n');
};

const formatValues = (
  values: readonly number[],
  digits: number,
  unit: string,
) => {
  if (values.length === 0) {
    return 'none';
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return `${formatSigned(middle, digits)}${unit} (${formatSigned(sorted[0], digits)}…${formatSigned(sorted[sorted.length - 1], digits)}), ${values.length} times`;
};

export const formatCursorTable = (result: CursorResult) => {
  const { run, stop, seek, playSeek, drag, loop, store, buffering } = result;
  const { play, spectrogram, apart } = result;
  const ms = (value: number) => `${Math.round(value)} ms`;
  return [
    '| Check | Result |',
    '| --- | --- |',
    `| Steps back while playing | ${run.stepsBack}, the largest ${ms(run.largestStepBackMs)} |`,
    `| The cursor standing while playing | ${run.stalls}, the longest ${ms(run.longestStallMs)} |`,
    `| The largest step after Stop, in screen frames | ${formatValues(stop.jumps, 1, '')} |`,
    `| The distance the cursor goes after Stop | ${formatValues(stop.distancesMs, 0, ' ms')} |`,
    `| Motion reversed after Stop, the largest | ${ms(stop.largestReversalMs)} |`,
    `| A seek to the shown target | ${formatValues(seek.settleMs, 0, ' ms')}; ${seek.unsettled} never shown |`,
    `| The cursor standing after a seek within Play's round trip | ${playSeek.standing} of ${playSeek.count}, the longest ${ms(playSeek.longestStandMs)} |`,
    `| Steps back in a drag | ${drag.stepsBack} in ${drag.count} drags |`,
    `| Behind the finger at the release | ${formatValues(drag.behindMs, 0, ' ms')} |`,
    `| Ahead of the sound after Play, the largest | ${formatValues(play.leadMs, 0, ' ms')} |`,
    `| The spectrogram: frames drawn, steps back while playing | ${spectrogram.count}, ${spectrogram.stepsBack}, the largest ${ms(spectrogram.largestStepBackMs)} |`,
    `| The spectrogram apart from the ruler while playing | median ${apart.medianMs.toFixed(1)} ms, the largest ${apart.largestMs.toFixed(1)} ms, of ${apart.count} frames |`,
    `| The spectrogram behind the finger at the release | ${formatValues(spectrogram.behindMs, 0, ' ms')} |`,
    `| The spectrogram ahead of the sound after Play, the largest | ${formatValues(spectrogram.leadMs, 0, ' ms')} |`,
    `| Loop: turns, steps back, the furthest past its end | ${loop.turns}, ${loop.stepsBack}, ${ms(loop.overshootMs)} |`,
    `| Changes of the store a second while playing | ${formatValues(store.changesPerSecond, 1, '')} |`,
    `| The cursor waiting for missing pages | ${formatValues(buffering.heldMs, 0, ' ms')} |`,
    '',
    `Screen frame ${result.screenFrameMs.toFixed(1)} ms.`,
  ].join('\n');
};

const formatBand = (center: number) =>
  center >= 1000 ? `${center / 1000} kHz` : `${center} Hz`;

const formatComparison = (
  app: number,
  browser: number,
  more: string,
  less: string,
) => {
  const difference = app - browser;
  return `${Math.abs(difference).toFixed(1)} dB ${difference >= 0 ? more : less}`;
};

export const formatSoundReport = (sound: SoundResult) => {
  const { app, browser } = sound;
  return [
    `| Band | ${bandCenters.map(formatBand).join(' | ')} |`,
    `| --- | ${bandCenters.map(() => '---:').join(' | ')} |`,
    `| Level | ${sound.bandDifference.map((value) => formatSigned(value, 1)).join(' | ')} dB |`,
    '',
    `- Bursts against the vowel: ${formatComparison(app.sibilantOverVowel, browser.sibilantOverVowel, 'louder', 'quieter')} than in the browser path.`,
    `- Peak: ${formatNumber(app.peak, 1)} dBFS against ${formatNumber(browser.peak, 1)}; samples at the limiter: ${app.limiterCount} against ${browser.limiterCount}.`,
    `- Noise in the pauses: ${formatNumber(app.pauseNoise, 1)} dBFS against ${formatNumber(browser.pauseNoise, 1)}, ${formatComparison(app.pauseNoise, browser.pauseNoise, 'more', 'less')} than in the browser path.`,
    `- Alignment with the played file: correlation ${app.correlation.toFixed(2)} in the app, ${browser.correlation.toFixed(2)} in the browser path.`,
  ].join('\n');
};

export const formatHoles = (holes: HoleResult, seconds: number) =>
  `Take with the song, ${seconds} s: ${holes.holeCount} gaps of exact zeros of 1 ms or longer, longest ${holes.longestMs.toFixed(2)} ms, level ${formatNumber(holes.rms, 1)} dBFS.`;
