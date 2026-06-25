import { createFourierCell } from '@musetric/fft/gpu';
import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
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
) => void;

export type SpectrogramLane = {
  signal: GPUBuffer;
  bandSpectra: SpectrogramBandSpectrum[];
  fundamentalFrequencyBuffer: GPUBuffer;
  writeSamples: (
    samples: Float32Array,
    trackProgress: number,
    work: SpectrogramLaneWork,
    contentChanged: boolean,
  ) => void;
  clearSignal: (encoder: GPUCommandEncoder, work: SpectrogramLaneWork) => void;
  dispatchSliceSamples: SpectrogramLaneDispatch;
  dispatchFourierTransform: SpectrogramLaneDispatch;
  dispatchMagnitudify: SpectrogramLaneDispatch;
  dispatchDecibelify: SpectrogramLaneDispatch;
  dispatchFundamentalFrequency: (pass: GPUComputePassEncoder) => void;
  clear: (encoder: GPUCommandEncoder) => void;
};

export type SpectrogramLaneCell = ResourceCell<
  ExtSpectrogramConfig,
  SpectrogramLane
>;

type BandSpectrumPipeline = {
  rawMagnitudeBuffer: GPUBuffer;
  columnEnergyBuffer: GPUBuffer;
  windowSize: number;
  writeSamples: (
    samples: Float32Array,
    trackProgress: number,
    contentChanged: boolean,
  ) => void;
  clearSignal: (encoder: GPUCommandEncoder) => void;
  dispatchSliceSamples: (pass: GPUComputePassEncoder) => void;
  dispatchFourier: (pass: GPUComputePassEncoder) => void;
  dispatchMagnitudify: (pass: GPUComputePassEncoder) => void;
  dispatchDecibelEnergy: (pass: GPUComputePassEncoder) => void;
  dispatchDecibelRun: (pass: GPUComputePassEncoder) => void;
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

const getSpectralBandSampleOffset = (
  config: ExtSpectrogramConfig,
  band: SpectrogramSpectralBand,
): number => (band.windowSize - config.windowSize) / 2;

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

const createBandSpectrumCell = (
  device: GPUDevice,
): ResourceCell<BandSpectrumCellArg, BandSpectrumPipeline> => {
  const signalCell = createSignalBufferCell(device);
  const sliceSamplesCell = createSpectrogramSliceSamplesCell(device);
  const fourierCell = createFourierCell(device);
  const magnitudifyCell = createSpectrogramMagnitudifyCell(device);
  const decibelifyCell = createSpectrogramDecibelifyCell(device);

  const cell = createResourceCell<BandSpectrumCellArg, BandSpectrumPipeline>({
    create: (arg) => {
      const { config, band, label } = arg;
      const bandConfig = createSpectralBandConfig(config, band);
      const signal = signalCell.get({
        windowSize: bandConfig.windowSize * bandConfig.zeroPaddingFactor,
        windowCount: bandConfig.windowCount,
      });
      const sliceSamples = sliceSamplesCell.get({
        out: signal,
        config: bandConfig,
        sampleOffset: getSpectralBandSampleOffset(config, band),
      });
      const fourier = fourierCell.get({
        signal,
        config: bandConfig,
      });
      const magnitudify = magnitudifyCell.get({
        signal,
        config: bandConfig,
      });
      const decibelify = decibelifyCell.get({
        signal,
        magnitude: magnitudify.magnitude,
        config: bandConfig,
        gainDb: bandConfig.lanes[label].gainDb,
      });

      return {
        rawMagnitudeBuffer: magnitudify.magnitude,
        columnEnergyBuffer: decibelify.columnEnergy,
        windowSize: bandConfig.windowSize * bandConfig.zeroPaddingFactor,
        writeSamples: (samples, trackProgress, contentChanged) => {
          sliceSamples.write(
            samples,
            trackProgress,
            bandConfig.lanes[label].truncateAfterPlayhead,
            contentChanged,
          );
        },
        dispatchSliceSamples: sliceSamples.dispatch,
        clearSignal: (encoder) => {
          if (bandConfig.zeroPaddingFactor > 1) {
            encoder.clearBuffer(signal);
          }
        },
        dispatchFourier: fourier.dispatch,
        dispatchMagnitudify: magnitudify.dispatch,
        dispatchDecibelEnergy: decibelify.dispatchEnergy,
        dispatchDecibelRun: decibelify.dispatchRun,
        clear: (encoder) => {
          encoder.clearBuffer(signal);
          encoder.clearBuffer(magnitudify.magnitude);
          encoder.clearBuffer(decibelify.columnEnergy);
        },
      };
    },
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
    get: (arg) => cell.get(arg),
    dispose: () => {
      cell.dispose();
      decibelifyCell.dispose();
      magnitudifyCell.dispose();
      fourierCell.dispose();
      sliceSamplesCell.dispose();
      signalCell.dispose();
    },
  };
};

export const createSpectrogramLaneCell = (
  device: GPUDevice,
  options: SpectrogramLaneOptions,
): SpectrogramLaneCell => {
  const signalCell = createSignalBufferCell(device);
  const sliceSamplesCell = createSpectrogramSliceSamplesCell(device);
  const fourierCell = createFourierCell(device);
  const magnitudifyCell = createSpectrogramMagnitudifyCell(device);
  const decibelifyCell = createSpectrogramDecibelifyCell(device);
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
      const signal = signalCell.get({
        windowSize: config.windowSize * config.zeroPaddingFactor,
        windowCount: config.windowCount,
      });
      const sliceSamples = sliceSamplesCell.get({
        out: signal,
        config,
        sampleOffset: 0,
      });
      const fourier = fourierCell.get({ signal, config });
      const magnitudify = magnitudifyCell.get({ signal, config });
      const decibelify = decibelifyCell.get({
        signal,
        magnitude: magnitudify.magnitude,
        config,
        gainDb: laneConfig.gainDb,
      });
      const fundamentalFrequency = fundamentalFrequencyCell.get({
        signal,
        config,
      });
      const baseBandPipeline: BandSpectrumPipeline = {
        rawMagnitudeBuffer: magnitudify.magnitude,
        columnEnergyBuffer: decibelify.columnEnergy,
        windowSize: config.windowSize * config.zeroPaddingFactor,
        writeSamples: (samples, trackProgress, contentChanged) => {
          sliceSamples.write(
            samples,
            trackProgress,
            laneConfig.truncateAfterPlayhead,
            contentChanged,
          );
        },
        dispatchSliceSamples: sliceSamples.dispatch,
        clearSignal: (encoder) => {
          if (config.zeroPaddingFactor > 1) {
            encoder.clearBuffer(signal);
          }
        },
        dispatchFourier: fourier.dispatch,
        dispatchMagnitudify: magnitudify.dispatch,
        dispatchDecibelEnergy: decibelify.dispatchEnergy,
        dispatchDecibelRun: decibelify.dispatchRun,
        clear: (encoder) => {
          encoder.clearBuffer(signal);
          encoder.clearBuffer(magnitudify.magnitude);
          encoder.clearBuffer(decibelify.columnEnergy);
        },
      };
      const externalSpectralBands = laneConfig.showSpectrogram
        ? config.spectralBands.filter(
            (band) => band.windowSize !== config.windowSize,
          )
        : [];
      const bandPipelines = getBandSpectrumCells(externalSpectralBands).map(
        (cell, index) => {
          const band = externalSpectralBands[index];
          return cell.get({
            config,
            band,
            label: options.label,
          });
        },
      );
      let externalBandPipelineIndex = 0;
      const spectrogramBandPipelines: BandSpectrumPipeline[] = [];
      if (laneConfig.showSpectrogram) {
        for (const band of config.spectralBands) {
          const pipeline =
            band.windowSize === config.windowSize
              ? baseBandPipeline
              : bandPipelines[externalBandPipelineIndex];
          if (band.windowSize !== config.windowSize) {
            externalBandPipelineIndex += 1;
          }
          if (!spectrogramBandPipelines.includes(pipeline)) {
            spectrogramBandPipelines.push(pipeline);
          }
        }
      }
      externalBandPipelineIndex = 0;
      const bandSpectra = laneConfig.showSpectrogram
        ? config.spectralBands.map((band) => {
            if (band.windowSize === config.windowSize) {
              return {
                rawMagnitudeBuffer: magnitudify.magnitude,
                columnEnergyBuffer: decibelify.columnEnergy,
                windowSize: config.windowSize * config.zeroPaddingFactor,
                band,
              };
            }
            const pipeline = bandPipelines[externalBandPipelineIndex];
            externalBandPipelineIndex += 1;
            return {
              rawMagnitudeBuffer: pipeline.rawMagnitudeBuffer,
              columnEnergyBuffer: pipeline.columnEnergyBuffer,
              windowSize: pipeline.windowSize,
              band,
            };
          })
        : [];

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
        signal,
        bandSpectra,
        fundamentalFrequencyBuffer: fundamentalFrequency.buffer,
        writeSamples: (samples, trackProgress, work, contentChanged) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.writeSamples(samples, trackProgress, contentChanged);
          });
        },
        clearSignal: (encoder, work) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.clearSignal(encoder);
          });
        },
        dispatchSliceSamples: (pass, work) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchSliceSamples(pass);
          });
        },
        dispatchFourierTransform: (pass, work) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchFourier(pass);
          });
        },
        dispatchMagnitudify: (pass, work) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchMagnitudify(pass);
          });
        },
        dispatchDecibelify: (pass, work) => {
          forEachWorkPipeline(work, (pipeline) => {
            pipeline.dispatchDecibelEnergy(pass);
          });
          if (work.fundamental) {
            baseBandPipeline.dispatchDecibelRun(pass);
          }
        },
        dispatchFundamentalFrequency: fundamentalFrequency.dispatch,
        clear: (encoder) => {
          encoder.clearBuffer(signal);
          encoder.clearBuffer(magnitudify.magnitude);
          encoder.clearBuffer(decibelify.columnEnergy);
          for (const pipeline of bandPipelines) {
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
    get: (config) => laneCell.get(config),
    dispose: () => {
      laneCell.dispose();
      for (const cell of bandSpectrumCells) {
        cell.dispose();
      }
      fundamentalFrequencyCell.dispose();
      decibelifyCell.dispose();
      magnitudifyCell.dispose();
      fourierCell.dispose();
      sliceSamplesCell.dispose();
      signalCell.dispose();
    },
  };
};
