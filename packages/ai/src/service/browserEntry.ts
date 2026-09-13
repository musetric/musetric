import { analyzeChords } from './browserChords.js';
import { startJobExecutor } from './browserExecutor.js';
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

const apis: BrowserJobApis = {
  [separateUnitsApiName]: separateUnits,
  [transcribeAudioApiName]: transcribeAudio,
  [analyzeChordsApiName]: analyzeChords,
  [analyzeRhythmApiName]: analyzeRhythm,
  [analyzeKeyApiName]: analyzeKey,
};

const reconnectDelayMs = 3000;

const readJobUrl = (): string => {
  const url = new URL(jobSocketPath, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

const connect = (): void => {
  startJobExecutor({
    jobUrl: readJobUrl(),
    apis,
    onClosed: () => {
      setTimeout(connect, reconnectDelayMs);
    },
  });
};

connect();
