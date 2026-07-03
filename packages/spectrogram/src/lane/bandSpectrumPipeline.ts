import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { isSpectrogramSpectralBandsEqual } from '../common/configFieldEqual.js';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
} from '../common/extConfig.js';
import {
  type SpectrogramSpectralBand,
  type TrackKey,
} from '../config.cross.js';
import {
  type BandPipelineCells,
  createBandPipelineCells,
  disposeBandPipelineCells,
} from './bandPipelineCells.js';
import { dispatchFourierColumnRange } from './fourierDispatch.js';

const createSpectralBandConfig = (
  config: ExtSpectrogramConfig,
  band: SpectrogramSpectralBand,
): ExtSpectrogramConfig => ({
  ...config,
  windowSize: band.windowSize,
});

type BandDispatchRange = (
  pass: GPUComputePassEncoder,
  range: SpectrogramColumnRange,
) => void;

export type BandSpectrumPipeline = {
  signal: GPUBuffer;
  rawMagnitudeBuffer: GPUBuffer;
  columnEnergyBuffer: GPUBuffer;
  windowSize: number;
  writeSamples: (
    samples: Float32Array,
    baseColumn: number,
    forceFullUpload: boolean,
    invalidations: readonly SpectrogramSampleRange[],
  ) => void;
  dispatchSliceSamples: BandDispatchRange;
  dispatchFourier: BandDispatchRange;
  dispatchMagnitudify: BandDispatchRange;
  dispatchDecibelEnergy: BandDispatchRange;
  dispatchDecibelRun: BandDispatchRange;
  clear: (encoder: GPUCommandEncoder) => void;
};

export const buildBandSpectrumPipeline = (
  cells: BandPipelineCells,
  config: ExtSpectrogramConfig,
  label: TrackKey,
): BandSpectrumPipeline => {
  const paddedWindowSize = config.windowSize * config.zeroPaddingFactor;
  const laneConfig = config.lanes[label];
  const signal = cells.signalCell.get({
    windowSize: paddedWindowSize,
    windowCount: config.windowCount,
  });
  const sliceSamples = cells.sliceSamplesCell.get({ out: signal, config });
  const fourier = cells.fourierCell.get({ signal, config });
  const magnitudify = cells.magnitudifyCell.get({ signal, config });
  const decibelify = cells.decibelifyCell.get({
    signal,
    magnitude: magnitudify.magnitude,
    config,
    gainDb: laneConfig.gainDb,
  });

  return {
    signal,
    rawMagnitudeBuffer: magnitudify.magnitude,
    columnEnergyBuffer: decibelify.columnEnergy,
    windowSize: paddedWindowSize,
    writeSamples: (samples, baseColumn, forceFullUpload, invalidations) => {
      sliceSamples.write({
        samples,
        baseColumn,
        truncateAfterPlayhead: laneConfig.truncateAfterPlayhead,
        forceFullUpload,
        invalidations,
      });
    },
    dispatchSliceSamples: sliceSamples.dispatch,
    dispatchFourier: (pass, range) => {
      dispatchFourierColumnRange(fourier, pass, range, config.windowCount);
    },
    dispatchMagnitudify: magnitudify.dispatch,
    dispatchDecibelEnergy: decibelify.dispatchEnergy,
    dispatchDecibelRun: decibelify.dispatchRun,
    clear: (encoder) => {
      encoder.clearBuffer(signal);
      encoder.clearBuffer(magnitudify.magnitude);
      encoder.clearBuffer(decibelify.columnEnergy);
    },
  };
};

type BandSpectrumCellArg = {
  config: ExtSpectrogramConfig;
  band: SpectrogramSpectralBand;
  label: TrackKey;
};

export const createBandSpectrumCell = (
  device: GPUDevice,
): ResourceCell<BandSpectrumCellArg, BandSpectrumPipeline> => {
  const cells = createBandPipelineCells(device);

  const cell = createResourceCell<BandSpectrumCellArg, BandSpectrumPipeline>({
    create: (arg) =>
      buildBandSpectrumPipeline(
        cells,
        createSpectralBandConfig(arg.config, arg.band),
        arg.label,
      ),
    dispose: () => undefined,
    equals: (current, next) =>
      current.config.fourierMode === next.config.fourierMode &&
      current.config.windowSize === next.config.windowSize &&
      current.config.zeroPaddingFactor === next.config.zeroPaddingFactor &&
      current.config.windowName === next.config.windowName &&
      current.config.sampleRate === next.config.sampleRate &&
      current.config.visibleTime === next.config.visibleTime &&
      current.config.playheadRatio === next.config.playheadRatio &&
      current.config.minDecibel === next.config.minDecibel &&
      current.config.maxFrequency === next.config.maxFrequency &&
      current.config.windowCount === next.config.windowCount &&
      current.config.lanes[current.label].gainDb ===
        next.config.lanes[next.label].gainDb &&
      current.config.lanes[current.label].truncateAfterPlayhead ===
        next.config.lanes[next.label].truncateAfterPlayhead &&
      current.label === next.label &&
      isSpectrogramSpectralBandsEqual([current.band], [next.band]),
  });

  return {
    get: cell.get,
    dispose: () => {
      cell.dispose();
      disposeBandPipelineCells(cells);
    },
  };
};
