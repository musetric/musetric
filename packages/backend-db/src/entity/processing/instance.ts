import type { DatabaseSync } from 'node:sqlite';
import { applyChordsResult } from './applyChordsResult.js';
import { applyKeyResult } from './applyKeyResult.js';
import { applyRhythmResult } from './applyRhythmResult.js';
import { applySeparationResult } from './applySeparationResult.js';
import { applyTranscriptionResult } from './applyTranscriptionResult.js';
import { pendingChords } from './pendingChords.js';
import { pendingKey } from './pendingKey.js';
import { pendingRhythm } from './pendingRhythm.js';
import { pendingSeparation } from './pendingSeparation.js';
import { pendingTranscription } from './pendingTranscription.js';

export const createInstance = (database: DatabaseSync) => ({
  pendingSeparation: pendingSeparation(database),
  pendingTranscription: pendingTranscription(database),
  pendingRhythm: pendingRhythm(database),
  pendingKey: pendingKey(database),
  pendingChords: pendingChords(database),
  applySeparationResult: applySeparationResult(database),
  applyTranscriptionResult: applyTranscriptionResult(database),
  applyRhythmResult: applyRhythmResult(database),
  applyKeyResult: applyKeyResult(database),
  applyChordsResult: applyChordsResult(database),
});
