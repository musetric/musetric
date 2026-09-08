import { type UnitProgress } from '../runtime/unitProgress.js';

export const separateUnitsApiName = 'musetricAiSeparateUnits';
export const reportPhaseApiName = 'musetricAiReportPhase';

export type BrowserRunningPass = 'decode' | 'repair';

export type BrowserRunningUnits = UnitProgress & {
  pass: BrowserRunningPass;
};

export type BrowserPhaseMessage =
  | { type: 'loading' }
  | ({ type: 'running' } & BrowserRunningUnits);

export type BrowserVocalsUnitsRequest = {
  attemptId: string;
  attemptUrl: string;
  stage: 'vocals';
  outputs: string[];
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
};

export type BrowserLeadBackingUnitsRequest = {
  attemptId: string;
  attemptUrl: string;
  stage: 'leadBacking';
  outputs: string[];
  leadBackingModelUrl: string;
};

export type BrowserSeparateUnitsRequest =
  | BrowserVocalsUnitsRequest
  | BrowserLeadBackingUnitsRequest;
