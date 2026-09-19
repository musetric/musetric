import { serveOrtWasmFromBundle } from '../runtime/ortWasm.js';
import { analyzeChords } from './browserChords.js';
import { describeLogged, startJobExecutor } from './browserExecutor.js';
import { type BrowserJobApis } from './browserJob.js';
import { analyzeKey } from './browserKey.js';
import { analyzeRhythm } from './browserRhythm.js';
import { separateUnits } from './browserSeparation.js';
import { transcribeAudio } from './browserTranscribe.js';
import { analyzeChordsApiName } from './chordsApi.js';
import { jobSocketPath } from './jobProtocol.js';
import { analyzeKeyApiName } from './keyApi.js';
import { analyzeRhythmApiName } from './rhythmApi.js';
import { separateUnitsApiName } from './separationApi.js';
import { transcribeAudioApiName } from './transcribeApi.js';

declare const window: { location: { reload: () => void } };

const apis: BrowserJobApis = {
  [separateUnitsApiName]: separateUnits,
  [transcribeAudioApiName]: transcribeAudio,
  [analyzeChordsApiName]: analyzeChords,
  [analyzeRhythmApiName]: analyzeRhythm,
  [analyzeKeyApiName]: analyzeKey,
};

const readJobUrl = (): string => {
  const url = new URL(jobSocketPath, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

serveOrtWasmFromBundle();

const executor = startJobExecutor({
  jobUrl: readJobUrl(),
  apis,
  reconnectDelayMs: 3000,
  restart: () => {
    window.location.reload();
  },
});

const forwardConsole = (level: 'error' | 'warn'): void => {
  const original = console[level];
  console[level] = (...values: unknown[]) => {
    original(...values);
    executor.log(level, values.map(describeLogged).join(' '));
  };
};

forwardConsole('error');
forwardConsole('warn');
addEventListener('error', (event) => {
  executor.log(
    'error',
    `${describeLogged(event.error ?? event.message)} at ${event.filename}:${event.lineno}`,
  );
});
addEventListener('unhandledrejection', (event) => {
  executor.log('error', `Unhandled rejection: ${describeLogged(event.reason)}`);
});
