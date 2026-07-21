import { registerChordsApi } from './browserChords.js';
import { registerRhythmApi } from './browserRhythm.js';
import { registerSeparationApi } from './browserSeparation.js';
import { registerTranscribeApi } from './browserTranscribe.js';

registerSeparationApi();
registerTranscribeApi();
registerChordsApi();
registerRhythmApi();
