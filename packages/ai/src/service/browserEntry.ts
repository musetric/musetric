import { readAndroidForeground } from './androidForeground.js';
import { analyzeChords } from './browserChords.js';
import { startJobExecutor } from './browserExecutor.js';
import { type BrowserJobApis } from './browserJob.js';
import { analyzeKey } from './browserKey.js';
import { analyzeRhythm } from './browserRhythm.js';
import { separateUnits } from './browserSeparation.js';
import { transcribeAudio } from './browserTranscribe.js';
import { analyzeChordsApiName } from './chordsApi.js';
import { jobUrlParameter } from './jobProtocol.js';
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

const jobUrl =
  new URLSearchParams(location.search).get(jobUrlParameter) ?? undefined;
if (jobUrl !== undefined) {
  startJobExecutor({ jobUrl, apis, foreground: readAndroidForeground() });
}
