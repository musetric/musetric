import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import { pitchLatticeCount, type PitchSettings } from './settings.es.js';

export type PitchDispatchValues = {
  slotCount: number;
  trackFrames: number;
  decodeFirst: number;
  decodeCount: number;
  smoothFirst: number;
  smoothCount: number;
  baseColumn: number;
  columnStep: number;
  windowCount: number;
  baseSlot: number;
};

type PitchParamValues = PitchSettings &
  PitchDispatchValues & { latticeCount: number };

type ParamKind = 'f32' | 'u32' | 'i32';

type NumericKey = {
  [Key in keyof PitchParamValues]: PitchParamValues[Key] extends number
    ? Key
    : never;
}[keyof PitchParamValues];

export const pitchParamFields: readonly (readonly [NumericKey, ParamKind])[] = [
  ['sampleRate', 'f32'],
  ['hop', 'u32'],
  ['windowSize', 'u32'],
  ['fftSize', 'u32'],
  ['halfSize', 'u32'],
  ['spectrumBins', 'u32'],
  ['phaseBins', 'u32'],
  ['support', 'u32'],
  ['windowOffset', 'u32'],
  ['levelOffsetDb', 'f32'],
  ['minimumFrequency', 'f32'],
  ['candidateCount', 'u32'],
  ['candidateStepCents', 'f32'],
  ['harmonicCount', 'u32'],
  ['peakSeparationCents', 'f32'],
  ['loudnessExponent', 'f32'],
  ['fundamentalWeight', 'f32'],
  ['antiWeight', 'f32'],
  ['envelopeHalfOctaves', 'f32'],
  ['envelopeMinHalfBins', 'f32'],
  ['levelFloorDb', 'f32'],
  ['levelRangeDb', 'f32'],
  ['minimumLag', 'u32'],
  ['lagCount', 'u32'],
  ['periodicityWindow', 'u32'],
  ['periodicityFloor', 'f32'],
  ['agreementBoostCap', 'f32'],
  ['refineHarmonics', 'u32'],
  ['refineTolerance', 'f32'],
  ['refineSearchBins', 'f32'],
  ['refineRangeDb', 'f32'],
  ['coarseRefineHarmonics', 'u32'],
  ['coarseRefineTolerance', 'f32'],
  ['voicingBias', 'f32'],
  ['voicingPeriodicity', 'f32'],
  ['voicingSalience', 'f32'],
  ['voicingShare', 'f32'],
  ['voicingLevel', 'f32'],
  ['historyFrames', 'u32'],
  ['lookaheadFrames', 'u32'],
  ['jumpCostCents', 'f32'],
  ['jumpCapCents', 'f32'],
  ['unvoicedCost', 'f32'],
  ['voicedTransitionCost', 'f32'],
  ['memoryWeight', 'f32'],
  ['memoryCapCents', 'f32'],
  ['memoryDecayFrames', 'f32'],
  ['voicingScale', 'f32'],
  ['confidenceScale', 'f32'],
  ['smoothBackFrames', 'u32'],
  ['smoothAheadFrames', 'u32'],
  ['smoothLimitCents', 'f32'],
  ['ringFrames', 'u32'],
  ['latticeCount', 'u32'],
  ['slotCount', 'u32'],
  ['trackFrames', 'i32'],
  ['decodeFirst', 'i32'],
  ['decodeCount', 'u32'],
  ['smoothFirst', 'i32'],
  ['smoothCount', 'u32'],
  ['baseColumn', 'i32'],
  ['columnStep', 'f32'],
  ['windowCount', 'u32'],
  ['baseSlot', 'u32'],
];

const paramsByteLength = pitchParamFields.length * 4;
const paramsCapacity = 64;

const writeField = (
  view: DataView,
  offset: number,
  kind: ParamKind,
  value: number,
): void => {
  if (kind === 'f32') {
    view.setFloat32(offset, value, true);
    return;
  }
  if (kind === 'i32') {
    view.setInt32(offset, value, true);
    return;
  }
  view.setUint32(offset, value, true);
};

export type PitchParams = {
  buffer: GPUBuffer;
  byteLength: number;
  write: (values: PitchDispatchValues) => number;
};

export const createPitchParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (settings: PitchSettings): PitchParams => {
      const params = createDynamicUniformParams(device, {
        label: 'pitch-params-buffer',
        byteLength: paramsByteLength,
        capacity: paramsCapacity,
      });
      return {
        buffer: params.buffer,
        byteLength: params.byteLength,
        write: (dispatchValues) =>
          params.write((view) => {
            const values: PitchParamValues = {
              ...settings,
              ...dispatchValues,
              latticeCount: pitchLatticeCount,
            };
            pitchParamFields.forEach((field, index) => {
              writeField(view, index * 4, field[1], values[field[0]]);
            });
          }),
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
