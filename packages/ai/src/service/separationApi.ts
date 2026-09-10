import {
  type LeadBackingGraph,
  type VocalsGraph,
} from '../runtime/modelGraphs.js';

export const separateUnitsApiName = 'musetricAiSeparateUnits';

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
