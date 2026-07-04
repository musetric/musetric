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
import { createSpectrogramFundamentalFrequencyCell } from '../fundamentalFrequency/index.js';
import {
  type BandPipelineCells,
  createBandPipelineCells,
  disposeBandPipelineCells,
} from './bandPipelineCells.js';
import {
  type BandSpectrumPipeline,
  buildBandSpectrumPipeline,
  createBandSpectrumCell,
} from './bandSpectrumPipeline.js';

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

export type SpectrogramLaneDispatch = (
  pass: GPUComputePassEncoder,
  work: SpectrogramLaneWork,
  range: SpectrogramColumnRange,
) => void;

export type SpectrogramLane = {
  signal: GPUBuffer;
  bandSpectra: SpectrogramBandSpectrum[];
  fundamentalLineBuffer: GPUBuffer;
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
  dispatchFundamentalObserve: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  dispatchFundamentalTrack: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  clear: (encoder: GPUCommandEncoder) => void;
};

export type SpectrogramLaneCell = ResourceCell<
  ExtSpectrogramConfig,
  SpectrogramLane
>;

const forEachWorkPipeline = (
  work: SpectrogramLaneWork,
  spectrogramBandPipelines: readonly BandSpectrumPipeline[],
  baseBandPipeline: BandSpectrumPipeline,
  fn: (pipeline: BandSpectrumPipeline) => void,
): void => {
  if (work.spectrogram) {
    for (const pipeline of spectrogramBandPipelines) {
      fn(pipeline);
    }
  }
  if (
    work.fundamental &&
    (!work.spectrogram || !spectrogramBandPipelines.includes(baseBandPipeline))
  ) {
    fn(baseBandPipeline);
  }
};

type BandSpectrumCell = ReturnType<typeof createBandSpectrumCell>;

type BuildSpectrogramLaneArgs = {
  cells: BandPipelineCells;
  fundamentalFrequencyCell: ReturnType<
    typeof createSpectrogramFundamentalFrequencyCell
  >;
  getBandSpectrumCells: (
    spectralBands: readonly SpectrogramSpectralBand[],
  ) => BandSpectrumCell[];
  options: SpectrogramLaneOptions;
  config: ExtSpectrogramConfig;
};

const buildSpectrogramLane = (
  args: BuildSpectrogramLaneArgs,
): SpectrogramLane => {
  const {
    cells,
    fundamentalFrequencyCell,
    getBandSpectrumCells,
    options,
    config,
  } = args;
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
  const bandPipelines: {
    band: SpectrogramSpectralBand;
    pipeline: BandSpectrumPipeline;
  }[] = laneConfig.showSpectrogram
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
  const bandSpectra: SpectrogramBandSpectrum[] = bandPipelines.map((entry) => ({
    rawMagnitudeBuffer: entry.pipeline.rawMagnitudeBuffer,
    columnEnergyBuffer: entry.pipeline.columnEnergyBuffer,
    windowSize: entry.pipeline.windowSize,
    band: entry.band,
  }));

  return {
    signal: baseBandPipeline.signal,
    bandSpectra,
    fundamentalLineBuffer: fundamentalFrequency.lineBuffer,
    writeSamples: (writeSamplesOptions) => {
      const { samples, baseColumn, work, forceFullUpload, invalidations } =
        writeSamplesOptions;
      forEachWorkPipeline(
        work,
        spectrogramBandPipelines,
        baseBandPipeline,
        (pipeline) => {
          pipeline.writeSamples(
            samples,
            baseColumn,
            forceFullUpload,
            invalidations,
          );
        },
      );
    },
    dispatchSliceSamples: (pass, work, range) => {
      forEachWorkPipeline(
        work,
        spectrogramBandPipelines,
        baseBandPipeline,
        (pipeline) => {
          pipeline.dispatchSliceSamples(pass, range);
        },
      );
    },
    dispatchFourierTransform: (pass, work, range) => {
      forEachWorkPipeline(
        work,
        spectrogramBandPipelines,
        baseBandPipeline,
        (pipeline) => {
          pipeline.dispatchFourier(pass, range);
        },
      );
    },
    dispatchMagnitudify: (pass, work, range) => {
      forEachWorkPipeline(
        work,
        spectrogramBandPipelines,
        baseBandPipeline,
        (pipeline) => {
          pipeline.dispatchMagnitudify(pass, range);
        },
      );
    },
    dispatchDecibelify: (pass, work, range) => {
      forEachWorkPipeline(
        work,
        spectrogramBandPipelines,
        baseBandPipeline,
        (pipeline) => {
          pipeline.dispatchDecibelEnergy(pass, range);
        },
      );
      if (work.fundamental) {
        baseBandPipeline.dispatchDecibelRun(pass, range);
      }
    },
    dispatchFundamentalObserve: fundamentalFrequency.dispatchObserve,
    dispatchFundamentalTrack: fundamentalFrequency.dispatchTrack,
    clear: (encoder) => {
      baseBandPipeline.clear(encoder);
      for (const pipeline of externalPipelines) {
        pipeline.clear(encoder);
      }
      encoder.clearBuffer(fundamentalFrequency.lineBuffer);
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
  const bandSpectrumCells: BandSpectrumCell[] = [];

  const getBandSpectrumCells = (
    spectralBands: readonly SpectrogramSpectralBand[],
  ) => {
    while (bandSpectrumCells.length < spectralBands.length) {
      bandSpectrumCells.push(createBandSpectrumCell(device));
    }
    while (bandSpectrumCells.length > spectralBands.length) {
      bandSpectrumCells.pop()?.dispose();
    }
    return bandSpectrumCells;
  };

  const laneCell = createResourceCell<ExtSpectrogramConfig, SpectrogramLane>({
    create: (config) =>
      buildSpectrogramLane({
        cells,
        fundamentalFrequencyCell,
        getBandSpectrumCells,
        options,
        config,
      }),
    dispose: () => undefined,
    equals: (current, next) => {
      const currentLane = current.lanes[options.label];
      const nextLane = next.lanes[options.label];
      return (
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
        currentLane.showSpectrogram === nextLane.showSpectrogram &&
        currentLane.gainDb === nextLane.gainDb &&
        currentLane.truncateAfterPlayhead === nextLane.truncateAfterPlayhead &&
        isSpectrogramSpectralBandsEqual(
          current.spectralBands,
          next.spectralBands,
        )
      );
    },
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
