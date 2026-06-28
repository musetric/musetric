import { createResourceCell, parseHexColor } from '@musetric/utils';
import {
  allTrackKeys,
  type SpectrogramComparison,
  type SpectrogramConfig,
  type SpectrogramLaneConfig,
} from '../config.cross.js';

const toVec4 = (hex: string): [number, number, number, number] => {
  const { red, green, blue } = parseHexColor(hex);
  return [red / 255, green / 255, blue / 255, 1];
};

export type StateColors = {
  buffer: GPUBuffer;
};

export const drawRingSlotsByteOffset = 160;
const areLaneConfigsEqual = (
  first: SpectrogramLaneConfig,
  second: SpectrogramLaneConfig,
) =>
  first.showSpectrogram === second.showSpectrogram &&
  first.showFundamental === second.showFundamental &&
  first.lineWidthCents === second.lineWidthCents &&
  first.gainDb === second.gainDb;

const areComparisonsEqual = (
  first: SpectrogramComparison,
  second: SpectrogramComparison,
) =>
  first.reference === second.reference &&
  first.target === second.target &&
  first.matchThresholdCents === second.matchThresholdCents &&
  first.closeThresholdCents === second.closeThresholdCents;

const areConfigsEqual = (
  current: SpectrogramConfig,
  next: SpectrogramConfig,
): boolean => {
  if (
    current.colors.foreground !== next.colors.foreground ||
    current.colors.background !== next.colors.background ||
    current.colors.primary !== next.colors.primary ||
    current.colors.recordingMatch !== next.colors.recordingMatch ||
    current.colors.recordingClose !== next.colors.recordingClose ||
    current.colors.recordingMiss !== next.colors.recordingMiss
  ) {
    return false;
  }
  if (
    current.minFrequency !== next.minFrequency ||
    current.maxFrequency !== next.maxFrequency
  ) {
    return false;
  }
  if (!areComparisonsEqual(current.comparison, next.comparison)) {
    return false;
  }
  return allTrackKeys.every((key) =>
    areLaneConfigsEqual(current.lanes[key], next.lanes[key]),
  );
};

export const createColorsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: SpectrogramConfig): StateColors => {
      const arrayBuffer = new ArrayBuffer(176);
      const f32 = new Float32Array(arrayBuffer);
      const u32 = new Uint32Array(arrayBuffer);
      const { colors, lanes, comparison } = config;
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
        targetLane.lineWidthCents,
        referenceLane.lineWidthCents,
      ] as const;
      f32.set([
        ...toVec4(colors.foreground),
        ...toVec4(colors.background),
        ...toVec4(colors.primary),
        ...frequencyMap,
        ...toVec4(colors.recordingMatch),
        ...toVec4(colors.recordingClose),
        ...toVec4(colors.recordingMiss),
        ...comparisonThresholds,
      ]);
      const layer0 = lanes[allTrackKeys[0]];
      const layer1 = lanes[allTrackKeys[1]];
      u32[32] = layer0.showSpectrogram ? 1 : 0;
      u32[33] = layer1.showSpectrogram ? 1 : 0;
      u32[34] = referenceLane.showFundamental ? 1 : 0;
      u32[35] = targetLane.showFundamental ? 1 : 0;
      u32[36] = allTrackKeys.indexOf(comparison.reference);
      u32[37] = allTrackKeys.indexOf(comparison.target);

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
