import { createResourceCell, parseHexColor } from '@musetric/utils';
import {
  isSpectrogramColorsEqual,
  isSpectrogramHarmonicComparisonEqual,
  isSpectrogramHarmonicsEqual,
  isSpectrogramStencilEqual,
} from '../common/configFieldEqual.js';
import {
  stackedLaneGap,
  stackedLaneRadius,
} from '../common/stackedLanes.es.js';
import { allTrackKeys } from '../common/trackKeys.es.js';
import {
  areHarmonicsShown,
  isHarmonicComparisonShown,
  isStencilShown,
  type SpectrogramComparison,
  type SpectrogramConfig,
  type SpectrogramLaneConfig,
} from '../config.cross.js';
import { remapLevelScale } from '../remap/params.js';

const toVec4 = (hex: string): [number, number, number, number] => {
  const { red, green, blue } = parseHexColor(hex);
  return [red / 255, green / 255, blue / 255, 1];
};

export const drawRingSlotsByteOffset = 400;

const noteGridStripeAmount = 0.12;
const fundamentalLineMaskBoost = 1.18;
const maxSegmentSpanCents = 720;
const stackedLineWidthPixels = 3;
const stackedLineOutlinePixels = 1;

const areLaneConfigsEqual = (
  first: SpectrogramLaneConfig,
  second: SpectrogramLaneConfig,
) =>
  first.showSpectrogram === second.showSpectrogram &&
  first.showFundamental === second.showFundamental &&
  first.showNotes === second.showNotes &&
  first.lineWidthCents === second.lineWidthCents &&
  first.gainDb === second.gainDb;

const areComparisonsEqual = (
  first: SpectrogramComparison,
  second: SpectrogramComparison,
) =>
  first.reference === second.reference &&
  first.target === second.target &&
  first.matchThresholdCents === second.matchThresholdCents &&
  first.closeThresholdCents === second.closeThresholdCents &&
  first.missThresholdCents === second.missThresholdCents;

const areConfigsEqual = (
  current: SpectrogramConfig,
  next: SpectrogramConfig,
): boolean => {
  if (!isSpectrogramColorsEqual(current.colors, next.colors)) {
    return false;
  }
  if (
    current.minFrequency !== next.minFrequency ||
    current.maxFrequency !== next.maxFrequency ||
    current.minDecibel !== next.minDecibel ||
    current.visibleTime !== next.visibleTime
  ) {
    return false;
  }
  if (
    !areComparisonsEqual(current.comparison, next.comparison) ||
    !isSpectrogramHarmonicsEqual(current.harmonics, next.harmonics) ||
    !isSpectrogramHarmonicComparisonEqual(
      current.harmonicComparison,
      next.harmonicComparison,
    ) ||
    !isSpectrogramStencilEqual(current.stencil, next.stencil)
  ) {
    return false;
  }
  return allTrackKeys.every((key) =>
    areLaneConfigsEqual(current.lanes[key], next.lanes[key]),
  );
};

export type StateColors = {
  buffer: GPUBuffer;
};

export const createColorsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: SpectrogramConfig): StateColors => {
      const arrayBuffer = new ArrayBuffer(416);
      const f32 = new Float32Array(arrayBuffer);
      const u32 = new Uint32Array(arrayBuffer);
      const { stencil } = config;
      const stencilTuning = [
        isStencilShown(config) ? stencil.opacity : 0,
        stencil.harmonicCount,
        stencil.lineWidthPixels,
        stencil.overtoneFade,
      ] as const;
      const stencilShape = [2 ** stencil.octaveShift, 0, 0, 0] as const;
      const { colors, lanes, comparison, harmonics, harmonicComparison } =
        config;
      const frequencyMap = [
        Math.log(config.minFrequency),
        Math.log(config.maxFrequency) - Math.log(config.minFrequency),
        0,
        0,
      ] as const;
      const referenceLane = lanes[comparison.reference];
      const targetLane = lanes[comparison.target];
      const comparisonThresholds = [
        comparison.matchThresholdCents,
        comparison.closeThresholdCents,
        comparison.missThresholdCents,
        0,
      ] as const;
      const lineWidths = [
        targetLane.lineWidthCents,
        referenceLane.lineWidthCents,
        stackedLineWidthPixels,
        stackedLineOutlinePixels,
      ] as const;
      const overlayTuning = [
        noteGridStripeAmount,
        fundamentalLineMaskBoost,
        maxSegmentSpanCents,
        0,
      ] as const;
      const laneLayout = [stackedLaneGap, stackedLaneRadius, 0, 0] as const;
      const harmonicTuning = [
        areHarmonicsShown(config) ? 1 : 0,
        harmonics.dominantMaxFrequency,
        harmonics.dominantSearchCents,
        (harmonics.dominantMarginDb * remapLevelScale) / -config.minDecibel,
      ] as const;
      const ringBand = [
        harmonics.ringMinFrequency,
        harmonics.ringMaxFrequency,
        harmonics.ringAmount,
        0,
      ] as const;
      const comparisonTuning = [
        isHarmonicComparisonShown(config) ? 1 : 0,
        harmonicComparison.pitchToleranceCents,
        harmonicComparison.neutralDb,
        harmonicComparison.fullDb,
      ] as const;
      const comparisonLevels = [
        harmonicComparison.floorDb,
        -config.minDecibel / remapLevelScale,
        harmonicComparison.maxHarmonics,
        harmonicComparison.missingAmount,
      ] as const;
      const harmonicShape = [
        harmonics.ridgeHalfWidthCents,
        harmonics.smoothingColumns,
        0,
        0,
      ] as const;
      f32.set([
        ...toVec4(colors.foreground),
        ...toVec4(colors.background),
        ...toVec4(colors.primary),
        ...frequencyMap,
        ...toVec4(colors.recordingMatch),
        ...toVec4(colors.recordingClose),
        ...toVec4(colors.recordingMiss),
        ...toVec4(colors.recordingTimingMiss),
        ...comparisonThresholds,
        ...lineWidths,
        ...overlayTuning,
        ...laneLayout,
        ...toVec4(colors.harmonic),
        ...harmonicTuning,
        ...ringBand,
        ...harmonicShape,
        ...comparisonTuning,
        ...comparisonLevels,
        ...toVec4(colors.harmonicQuieter),
        ...toVec4(colors.harmonicLouder),
        ...toVec4(colors.stencil),
        ...stencilTuning,
        ...stencilShape,
      ]);
      const layer0 = lanes[allTrackKeys[0]];
      const layer1 = lanes[allTrackKeys[1]];
      u32[92] = layer0.showSpectrogram ? 1 : 0;
      u32[93] = layer1.showSpectrogram ? 1 : 0;
      u32[94] = referenceLane.showFundamental ? 1 : 0;
      u32[95] = targetLane.showFundamental ? 1 : 0;
      u32[96] = referenceLane.showNotes ? 1 : 0;
      u32[97] = targetLane.showNotes ? 1 : 0;

      const buffer = device.createBuffer({
        label: 'draw-colors-buffer',
        size: arrayBuffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, arrayBuffer);

      return {
        buffer,
      };
    },
    dispose: (state) => {
      state.buffer.destroy();
    },
    equals: areConfigsEqual,
  });
