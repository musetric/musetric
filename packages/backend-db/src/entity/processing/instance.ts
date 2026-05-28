import type { DatabaseSync } from 'node:sqlite';
import { applyRhythmResult } from './applyRhythmResult.js';
import { applySeparationResult } from './applySeparationResult.js';
import { applyTranscriptionResult } from './applyTranscriptionResult.js';
import { pendingRhythm } from './pendingRhythm.js';
import { pendingSeparation } from './pendingSeparation.js';
import { pendingTranscription } from './pendingTranscription.js';

export const createInstance = (database: DatabaseSync) => ({
  pendingSeparation: pendingSeparation(database),
  pendingTranscription: pendingTranscription(database),
  pendingRhythm: pendingRhythm(database),
  applySeparationResult: applySeparationResult(database),
  applyTranscriptionResult: applyTranscriptionResult(database),
  applyRhythmResult: applyRhythmResult(database),
});
