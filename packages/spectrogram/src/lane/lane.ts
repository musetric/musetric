import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { isSpectrogramSpectralBandsEqual } from '../common/configFieldEqual.js';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
} from '../common/extConfig.js';
import { type SpectrogramSource } from '../common/source.js';
import {
  type SpectrogramSpectralBand,
  type TrackKey,
} from '../config.cross.js';
import {
  createSpectrogramFundamentalFrequencyCell,
  type PitchPrepareInput,
} from '../fundamentalFrequency/index.js';
import { type PitchSettings } from '../fundamentalFrequency/settings.es.js';
import { createStateSamplesCell } from '../sliceSamples/samples.js';
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
import { type ColumnScaleWrite, createColumnScaleCell } from './columnScale.js';

export type SpectrogramLaneWork = {
  spectrogram: boolean;
  fundamental: boolean;
};

const forEachWorkPipeline = (
  work: SpectrogramLaneWork,
  spectrogramBandPipelines: readonly BandSpectrumPipeline[],
  fn: (pipeline: BandSpectrumPipeline) => void,
): void => {
  if (!work.spectrogram) {
    return;
  }
  for (const pipeline of spectrogramBandPipelines) {
    fn(pipeline);
  }
};

type BandSpectrumCell = ReturnType<typeof createBandSpectrumCell>;

export type SpectrogramLaneOptions = {
  label: TrackKey;
};

type BuildSpectrogramLaneArgs = {
  cells: BandPipelineCells;
  samplesCell: ReturnType<typeof createStateSamplesCell>;
  columnScaleCell: ReturnType<typeof createColumnScaleCell>;
  fundamentalFrequencyCell: ReturnType<
    typeof createSpectrogramFundamentalFrequencyCell
  >;
  getBandSpectrumCells: (
    spectralBands: readonly SpectrogramSpectralBand[],
  ) => BandSpectrumCell[];
  options: SpectrogramLaneOptions;
  config: ExtSpectrogramConfig;
};

export type SpectrogramBandSpectrum = {
  rawMagnitudeBuffer: GPUBuffer;
  columnEnergyBuffer: GPUBuffer;
  windowSize: number;
  band: SpectrogramSpectralBand;
};

export type SpectrogramLaneDispatch = (
  pass: GPUComputePassEncoder,
  work: SpectrogramLaneWork,
  range: SpectrogramColumnRange,
) => void;

export type SpectrogramLane = {
  bandSpectra: SpectrogramBandSpectrum[];
  fundamentalLineBuffer: GPUBuffer;
  fundamentalDecodedBuffer: GPUBuffer;
  columnScaleBuffer: GPUBuffer;
  writeColumnScales: (write: Omit<ColumnScaleWrite, 'columnStep'>) => void;
  pitchSettings: PitchSettings;
  preparePitch: (input: PitchPrepareInput) => void;
  dispatchPitch: (pass: GPUComputePassEncoder) => void;
  pitchPending: () => boolean;
  writeSamples: (options: {
    source: SpectrogramSource;
    baseColumn: number;
    playheadRatio: number;
    work: SpectrogramLaneWork;
    forceFullUpload: boolean;
    invalidations: readonly SpectrogramSampleRange[];
  }) => void;
  dispatchSliceSamples: SpectrogramLaneDispatch;
  dispatchFourierTransform: SpectrogramLaneDispatch;
  dispatchMagnitudify: SpectrogramLaneDispatch;
  dispatchDecibelify: SpectrogramLaneDispatch;
  clear: (encoder: GPUCommandEncoder) => void;
};

const buildSpectrogramLane = (
  args: BuildSpectrogramLaneArgs,
): SpectrogramLane => {
  const {
    cells,
    samplesCell,
    columnScaleCell,
    fundamentalFrequencyCell,
    getBandSpectrumCells,
    options,
    config,
  } = args;
  const laneConfig = config.lanes[options.label];
  const sampleConfig = {
    ...config,
    windowSize: Math.max(
      config.windowSize,
      ...config.spectralBands.map((band) => band.windowSize),
    ),
  };
  const samples = laneConfig.showSpectrogram
    ? samplesCell.get({
        ringLength:
          Math.ceil(
            config.visibleTime * config.sampleRate + sampleConfig.windowSize,
          ) * Math.ceil(laneConfig.sourceStretch),
      })
    : undefined;
  const baseBandPipeline = samples
    ? buildBandSpectrumPipeline(cells, config, options.label, samples)
    : undefined;
  if (!baseBandPipeline) {
    disposeBandPipelineCells(cells);
    samplesCell.dispose();
  }
  const columnScale = columnScaleCell.get(config.windowCount);
  const fundamentalFrequency = fundamentalFrequencyCell.get({
    sampleRate: config.sampleRate,
    fourierMode: config.fourierMode,
    columnStep: config.columnStep,
    windowCount: config.windowCount,
    columnScale: columnScale.buffer,
  });

  const externalSpectralBands = laneConfig.showSpectrogram
    ? config.spectralBands.filter(
        (band) => band.windowSize !== config.windowSize,
      )
    : [];
  const externalCells = getBandSpectrumCells(externalSpectralBands);
  const externalPipelines = samples
    ? externalCells.map((cell, index) =>
        cell.get({
          config,
          band: externalSpectralBands[index],
          label: options.label,
          samples,
        }),
      )
    : [];

  let externalIndex = 0;
  const bandPipelines: {
    band: SpectrogramSpectralBand;
    pipeline: BandSpectrumPipeline;
  }[] = baseBandPipeline
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
    bandSpectra,
    fundamentalLineBuffer: fundamentalFrequency.lineBuffer,
    fundamentalDecodedBuffer: fundamentalFrequency.decodedBuffer,
    columnScaleBuffer: columnScale.buffer,
    writeColumnScales: (write) => {
      columnScale.write({ ...write, columnStep: config.columnStep });
    },
    pitchSettings: fundamentalFrequency.settings,
    preparePitch: fundamentalFrequency.prepare,
    dispatchPitch: fundamentalFrequency.dispatch,
    pitchPending: fundamentalFrequency.pending,
    writeSamples: (writeSamplesOptions) => {
      const { work, ...write } = writeSamplesOptions;
      if (!work.spectrogram || !samples) {
        return;
      }
      const frame = samples.write({
        ...write,
        config: sampleConfig,
        truncateAfterPlayhead: laneConfig.truncateAfterPlayhead,
      });
      forEachWorkPipeline(work, spectrogramBandPipelines, (pipeline) => {
        pipeline.writeSamples({
          source: write.source,
          baseColumn: write.baseColumn,
          frame,
        });
      });
    },
    dispatchSliceSamples: (pass, work, range) => {
      forEachWorkPipeline(work, spectrogramBandPipelines, (pipeline) => {
        pipeline.dispatchSliceSamples(pass, range);
      });
    },
    dispatchFourierTransform: (pass, work, range) => {
      forEachWorkPipeline(work, spectrogramBandPipelines, (pipeline) => {
        pipeline.dispatchFourier(pass, range);
      });
    },
    dispatchMagnitudify: (pass, work, range) => {
      forEachWorkPipeline(work, spectrogramBandPipelines, (pipeline) => {
        pipeline.dispatchMagnitudify(pass, range);
      });
    },
    dispatchDecibelify: (pass, work, range) => {
      forEachWorkPipeline(work, spectrogramBandPipelines, (pipeline) => {
        pipeline.dispatchDecibelEnergy(pass, range);
      });
    },
    clear: (encoder) => {
      baseBandPipeline?.clear(encoder);
      for (const pipeline of externalPipelines) {
        pipeline.clear(encoder);
      }
      fundamentalFrequency.clear(encoder);
    },
  };
};

export type SpectrogramLaneCell = ResourceCell<
  ExtSpectrogramConfig,
  SpectrogramLane
>;

export const createSpectrogramLaneCell = (
  device: GPUDevice,
  options: SpectrogramLaneOptions,
): SpectrogramLaneCell => {
  const cells = createBandPipelineCells(device);
  const samplesCell = createStateSamplesCell(device);
  const columnScaleCell = createColumnScaleCell(device);
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
        samplesCell,
        columnScaleCell,
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
      columnScaleCell.dispose();
      disposeBandPipelineCells(cells);
      samplesCell.dispose();
    },
  };
};
