import { registerChordsApi } from './browserChords.js';
import { startJobExecutor } from './browserExecutor.js';
import { gpuSupportApiName, readGpuSupport } from './browserGpuSupport.js';
import { registerRhythmApi } from './browserRhythm.js';
import { registerSeparationApi } from './browserSeparation.js';
import { registerTranscribeApi } from './browserTranscribe.js';
import { jobUrlParameter } from './jobProtocol.js';

registerSeparationApi();
registerTranscribeApi();
registerChordsApi();
registerRhythmApi();
Reflect.set(globalThis, gpuSupportApiName, readGpuSupport);

const jobUrl =
  new URLSearchParams(location.search).get(jobUrlParameter) ?? undefined;
if (jobUrl !== undefined) {
  startJobExecutor(jobUrl);
}
