import {
  type BeatThisGraph,
  type ChordNetGraph,
  type ChunkGeometry,
  type LeadBackingGraph,
  type SkeyGraph,
  type VocalsGraph,
} from '../../runtime/modelGraphs.js';
import { type ParityGraphValue } from './parityModels.js';

export type ParityGraphFields = Record<string, ParityGraphValue>;

const numberField = (graph: ParityGraphFields, key: string): number => {
  const value = graph[key];
  if (typeof value !== 'number') {
    throw new Error(`graph field ${key} is not a number`);
  }
  return value;
};

export const stringField = (graph: ParityGraphFields, key: string): string => {
  const value = graph[key];
  if (typeof value !== 'string') {
    throw new Error(`graph field ${key} is not a string`);
  }
  return value;
};

type ModelIo = {
  inputName: string;
  outputName: string;
};

const modelIo = (graph: ParityGraphFields): ModelIo => ({
  inputName: stringField(graph, 'inputName'),
  outputName: stringField(graph, 'outputName'),
});

const geometry = (graph: ParityGraphFields): ChunkGeometry => ({
  nFft: numberField(graph, 'nFft'),
  hop: numberField(graph, 'hop'),
  frames: numberField(graph, 'frames'),
  channels: numberField(graph, 'channels'),
  chunkSamples: numberField(graph, 'chunkSamples'),
});

export const vocalsGraph = (graph: ParityGraphFields): VocalsGraph => ({
  ...geometry(graph),
  ...modelIo(graph),
  minStorageBuffersPerShaderStage: numberField(
    graph,
    'minStorageBuffersPerShaderStage',
  ),
});

export const leadBackingGraph = (
  graph: ParityGraphFields,
): LeadBackingGraph => ({
  ...geometry(graph),
  ...modelIo(graph),
  dimF: numberField(graph, 'dimF'),
});

export const beatThisGraph = (graph: ParityGraphFields): BeatThisGraph => ({
  inputName: stringField(graph, 'inputName'),
  beatOutputName: stringField(graph, 'beatOutputName'),
  downbeatOutputName: stringField(graph, 'downbeatOutputName'),
  nFft: numberField(graph, 'nFft'),
  hopLength: numberField(graph, 'hopLength'),
  fps: numberField(graph, 'fps'),
  melBins: numberField(graph, 'melBins'),
  logMultiplier: numberField(graph, 'logMultiplier'),
  chunkSize: numberField(graph, 'chunkSize'),
  borderSize: numberField(graph, 'borderSize'),
});

export const chordNetGraph = (graph: ParityGraphFields): ChordNetGraph => ({
  ...modelIo(graph),
  frameDuration: numberField(graph, 'frameDuration'),
  sequenceLength: numberField(graph, 'sequenceLength'),
  inputBins: numberField(graph, 'inputBins'),
  chordCount: numberField(graph, 'chordCount'),
  windowsPerRun: numberField(graph, 'windowsPerRun'),
});

export const skeyGraph = (graph: ParityGraphFields): SkeyGraph => ({
  ...modelIo(graph),
});
