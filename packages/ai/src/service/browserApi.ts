import {
  type LeadBackingGraph,
  type VocalsGraph,
} from '../runtime/modelGraphs.js';
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
  graph: VocalsGraph;
  vocalsModelUrl: string;
  vocalsModelDataUrl: string;
  vocalsModelDataPath: string;
};

export type BrowserLeadBackingUnitsRequest = {
  attemptId: string;
  attemptUrl: string;
  stage: 'leadBacking';
  outputs: string[];
  graph: LeadBackingGraph;
  leadBackingModelUrl: string;
};

export type BrowserSeparateUnitsRequest =
  | BrowserVocalsUnitsRequest
  | BrowserLeadBackingUnitsRequest;
