import { createFourierCell, type Fourier } from '@musetric/fft/gpu';
import { createResourceCell, type ResourceCell } from '@musetric/utils';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
} from '../common/extConfig.js';
import {
  type SpectrogramSpectralBand,
  type TrackKey,
} from '../config.cross.js';
import { createSpectrogramDecibelifyCell } from '../decibelify/index.js';
import { createSpectrogramFundamentalFrequencyCell } from '../fundamentalFrequency/index.js';
import { createSpectrogramMagnitudifyCell } from '../magnitudify/index.js';
import { createSpectrogramSliceSamplesCell } from '../sliceSamples/index.js';
import { createSignalBufferCell } from '../state/signal.js';

export type SpectrogramLaneOptions = {
  label: TrackKey;
};

export type SpectrogramBandSpectrum = {
  rawMagnitudeBuffer: GPUBuffer;
  columnEnergyBuffer: GPUBuffer;
  windowSize: number;
  band: SpectrogramSpectralBand;
};

export type SpectrogramLaneWork = {
  spectrogram: boolean;
  fundamental: boolean;
};

type SpectrogramLaneDispatch = (
  pass: GPUComputePassEncoder,
  work: SpectrogramLaneWork,
  range: SpectrogramColumnRange,
) => void;

export type SpectrogramLane = {
  signal: GPUBuffer;
  bandSpectra: SpectrogramBandSpectrum[];
  fundamentalFrequencyBuffer: GPUBuffer;
  writeSamples: (options: {
    samples: Float32Array;
    baseColumn: number;
    work: SpectrogramLaneWork;
    forceFullUpload: boolean;
    invalidations: readonly SpectrogramSampleRange[];
  }) => void;
  dispatchSliceSamples: SpectrogramLaneDispatch;
  dispatchFourierTransform: SpectrogramLaneDispatch;
  dispatchMagnitudify: SpectrogramLaneDispatch;
  dispatchDecibelify: SpectrogramLaneDispatch;
  dispatchFundamentalScore: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  dispatchFundamentalFilter: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  clear: (encoder: GPUCommandEncoder) => void;
};

export type SpectrogramLaneCell = ResourceCell<
  ExtSpectrogramConfig,
  SpectrogramLane
>;

type BandSpectrumPipeline = {
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
  dispatchSliceSamples: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  dispatchFourier: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  dispatchMagnitudify: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  dispatchDecibelEnergy: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  dispatchDecibelRun: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  clear: (encoder: GPUCommandEncoder) => void;
};

type BandSpectrumCellArg = {
  config: ExtSpectrogramConfig;
  band: SpectrogramSpectralBand;
  label: TrackKey;
};

const createSpectralBandConfig = (
  config: ExtSpectrogramConfig,
  band: SpectrogramSpectralBand,
): ExtSpectrogramConfig => ({
  ...config,
  windowSize: band.windowSize,
});

const areSpectralBandsEqual = (
  current: SpectrogramSpectralBand,
  next: SpectrogramSpectralBand,
) =>
  current.label === next.label &&
  current.windowSize === next.windowSize &&
  current.minFrequency === next.minFrequency &&
  current.fullMinFrequency === next.fullMinFrequency &&
  current.fullMaxFrequency === next.fullMaxFrequency &&
  current.maxFrequency === next.maxFrequency;

const areSpectralBandListsEqual = (
  current: SpectrogramSpectralBand[],
  next: SpectrogramSpectralBand[],
) =>
  current.length === next.length &&
  current.every((band, index) => areSpectralBandsEqual(band, next[index]));

type BandPipelineCells = {
  signalCell: ReturnType<typeof createSignalBufferCell>;
  sliceSamplesCell: ReturnType<typeof createSpectrogramSliceSamplesCell>;
  fourierCell: ReturnType<typeof createFourierCell>;
  magnitudifyCell: ReturnType<typeof createSpectrogramMagnitudifyCell>;
  decibelifyCell: ReturnType<typeof createSpectrogramDecibelifyCell>;
};

const createBandPipelineCells = (device: GPUDevice): BandPipelineCells => ({
  signalCell: createSignalBufferCell(device),
  sliceSamplesCell: createSpectrogramSliceSamplesCell(device),
  fourierCell: createFourierCell(device),
  magnitudifyCell: createSpectrogramMagnitudifyCell(device),
  decibelifyCell: createSpectrogramDecibelifyCell(device),
});

const disposeBandPipelineCells = (cells: BandPipelineCells): void => {
  cells.decibelifyCell.dispose();
  cells.magnitudifyCell.dispose();
  cells.fourierCell.dispose();
  cells.sliceSamplesCell.dispose();
  cells.signalCell.dispose();
};

export const dispatchFourierColumnRange = (
  fourier: Fourier,
  pass: GPUComputePassEncoder,
  range: SpectrogramColumnRange,
  windowCount: number,
): void => {
  if (range.columnCount <= 0) {
    return;
  }
  if (range.columnCount >= windowCount) {
    fourier.dispatch(pass);
    return;
  }
  const firstBatchCount = Math.min(
    range.columnCount,
    windowCount - range.slotOffset,
  );
  if (firstBatchCount > 0) {
    fourier.dispatch(pass, {
      batchOffset: range.slotOffset,
      batchCount: firstBatchCount,
    });
  }
  const secondBatchCount = range.columnCount - firstBatchCount;
  if (secondBatchCount > 0) {
    fourier.dispatch(pass, {
      batchOffset: 0,
      batchCount: secondBatchCount,
    });
  }
};

const buildBandSpectrumPipeline = (
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

const createBandSpectrumCell = (
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
      areSpectralBandsEqual(current.band, next.band),
  });

  return {
    get: cell.get,
    dispose: () => {
      cell.dispose();
      disposeBandPipelineCells(cells);
    },
  };
};

export const createSpectrogramLaneCell = (
  device: GPUDevice,
  options: SpectrogramLaneOptions,
): SpectrogramLaneCell => {
  const cells = createBandPipelineCells(device);
  const fundamentalFrequencyCell =
    createSpectrogramFundamentalFrequencyCell(device);
  const bandSpectrumCells: ReturnType<typeof createBandSpectrumCell>[] = [];

  const getBandSpectrumCells = (spectralBands: SpectrogramSpectralBand[]) => {
    while (bandSpectrumCells.length < spectralBands.length) {
      bandSpectrumCells.push(createBandSpectrumCell(device));
    }
    while (bandSpectrumCells.length > spectralBands.length) {
      bandSpectrumCells.pop()?.dispose();
    }
    return bandSpectrumCells;
  };

  const laneCell = createResourceCell<ExtSpectrogramConfig, SpectrogramLane>({
    create: (config): SpectrogramLane => {
      const laneConfig = config.lanes[options.label];
      const baseBandPipeline = buildBandSpectrumPipeline(
        cells,
        config,
        options.label,
      );
      const fundamentalFrequency = fundamentalFrequencyCell.get({
        signal: baseBandPipeline.signal,
        config,
      });

      const externalSpectralBands = laneConfig.showSpectrogram
        ? config.spectralBands.filter(
            (band) => band.windowSize !== config.windowSize,
          )
        : [];
      const externalPipelines = getBandSpectrumCells(externalSpectralBands).map(
        (cell, index) =>
          cell.get({
            config,
            band: externalSpectralBands[index],
            label: options.label,
          }),
      );
      let externalIndex = 0;
      const bandPipelines = laneConfig.showSpectrogram
        ? config.spectralBands.map((band) => {
            const pipeline =
              band.windowSize === config.windowSize
                ? baseBandPipeline
                : externalPipelines[externalIndex++];
            return { band, pipeline };
          })
        : [];
      const spectrogramBandPipelines = [
        ...new Set(bandPipelines.map((entry) => entry.pipeline)),
      ];
      const bandSpectra: SpectrogramBandSpectrum[] = bandPipelines.map(
        (entry) => ({
          rawMagnitudeBuffer: entry.pipeline.rawMagnitudeBuffer,
          columnEnergyBuffer: entry.pipeline.columnEnergyBuffer,
          windowSize: entry.pipeline.windowSize,
          band: entry.band,
        }),
      );

      const forEachWorkPipeline = (
        work: SpectrogramLaneWork,
        fn: (pipeline: BandSpectrumPipeline) => void,
      ) => {
        if (work.spectrogram) {
          for (const pipeline of spectrogramBandPipelines) {
            fn(pipeline);
          }
        }
        if (
          work.fundamental &&
          (!work.spectrogram ||
            !spectrogramBandPipelines.includes(baseBandPipeline))
        ) {
          fn(baseBandPipeline);
        }
      };

      return {
        signal: baseBandPipeline.signal,
        bandSpectra,
        fundamentalFrequencyBuffer: fundamentalFrequency.buffer,
        writeSamples: (writeSamplesOptions) => {
          const { samples, baseColumn, work, forceFullUpload, invalidations } =
            writeSamplesOptions;
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.writeSamples(
              samples,
              baseColumn,
              forceFullUpload,
              invalidations,
            );
          });
        },
        dispatchSliceSamples: (pass, work, range) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchSliceSamples(pass, range);
          });
        },
        dispatchFourierTransform: (pass, work, range) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchFourier(pass, range);
          });
        },
        dispatchMagnitudify: (pass, work, range) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchMagnitudify(pass, range);
          });
        },
        dispatchDecibelify: (pass, work, range) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchDecibelEnergy(pass, range);
          });
          if (work.fundamental) {
            baseBandPipeline.dispatchDecibelRun(pass, range);
          }
        },
        dispatchFundamentalScore: fundamentalFrequency.dispatchScore,
        dispatchFundamentalFilter: fundamentalFrequency.dispatchFilter,
        clear: (encoder) => {
          baseBandPipeline.clear(encoder);
          for (const pipeline of externalPipelines) {
            pipeline.clear(encoder);
          }
          encoder.clearBuffer(fundamentalFrequency.buffer);
        },
      };
    },
    dispose: () => undefined,
    equals: (current, next) =>
      current.fourierMode === next.fourierMode &&
      current.windowSize === next.windowSize &&
      current.zeroPaddingFactor === next.zeroPaddingFactor &&
      current.windowName === next.windowName &&
      current.sampleRate === next.sampleRate &&
      current.visibleTime === next.visibleTime &&
      current.playheadRatio === next.playheadRatio &&
      current.minDecibel === next.minDecibel &&
      current.maxFrequency === next.maxFrequency &&
      current.windowCount === next.windowCount &&
      current.lanes[options.label].showSpectrogram ===
        next.lanes[options.label].showSpectrogram &&
      current.lanes[options.label].gainDb ===
        next.lanes[options.label].gainDb &&
      current.lanes[options.label].truncateAfterPlayhead ===
        next.lanes[options.label].truncateAfterPlayhead &&
      areSpectralBandListsEqual(current.spectralBands, next.spectralBands),
  });

  return {
    get: laneCell.get,
    dispose: () => {
      laneCell.dispose();
      for (const cell of bandSpectrumCells) {
        cell.dispose();
      }
      fundamentalFrequencyCell.dispose();
      disposeBandPipelineCells(cells);
    },
  };
};
