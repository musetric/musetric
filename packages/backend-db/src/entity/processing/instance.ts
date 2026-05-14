import type { DatabaseSync } from 'node:sqlite';
import { applySeparationResult } from './applySeparationResult.js';
import { applyTranscriptionResult } from './applyTranscriptionResult.js';
import { pendingSeparation } from './pendingSeparation.js';
import { pendingTranscription } from './pendingTranscription.js';

export const createInstance = (database: DatabaseSync) => ({
  pendingSeparation: pendingSeparation(database),
  pendingTranscription: pendingTranscription(database),
  applySeparationResult: applySeparationResult(database),
  applyTranscriptionResult: applyTranscriptionResult(database),
});
