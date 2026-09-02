import { type ChordResult } from '../chords/chordSegments.js';

export const analyzeChordsApiName = 'musetricAiAnalyzeChords';

export type BrowserAnalyzeChordsRequest = {
  pcmUrl: string;
  modelUrl: string;
  planUrl: string;
  planManifestUrl?: string;
};

export type BrowserAnalyzeChordsResult = ChordResult;
