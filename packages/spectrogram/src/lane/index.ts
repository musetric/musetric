import {
  createFourierCell,
  createSpectrogramWindowingCell,
} from '@musetric/fft/gpu';
import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { type TrackKey } from '../config.cross.js';
import { createSpectrogramDecibelifyCell } from '../decibelify/index.js';
import { createSpectrogramFundamentalFrequencyCell } from '../fundamentalFrequency/index.js';
import { createSpectrogramMagnitudifyCell } from '../magnitudify/index.js';
import { createSpectrogramSliceSamplesCell } from '../sliceSamples/index.js';
import { createSignalBufferCell } from '../state/signal.js';

export type SpectrogramLaneMarkers = {
  sliceSamples?: GPUComputePassTimestampWrites;
  windowing?: GPUComputePassTimestampWrites;
  fourierReverse?: GPUComputePassTimestampWrites;
  fourierTransform?: GPUComputePassTimestampWrites;
  magnitudify?: GPUComputePassTimestampWrites;
  decibelify?: GPUComputePassTimestampWrites;
  fundamentalFrequency?: GPUComputePassTimestampWrites;
};

export type SpectrogramLaneOptions = {
  label: TrackKey;
  markers?: SpectrogramLaneMarkers;
};

export type SpectrogramLane = {
  signal: ComplexGpuBuffer;
  fundamentalFrequencyBuffer: GPUBuffer;
  writeSamples: (samples: Float32Array, trackProgress: number) => void;
  run: (encoder: GPUCommandEncoder) => void;
  skip: (encoder: GPUCommandEncoder, clear: boolean) => void;
};

export type SpectrogramLaneCell = ResourceCell<
  ExtSpectrogramConfig,
  SpectrogramLane
>;

export const createSpectrogramLaneCell = (
  device: GPUDevice,
  options: SpectrogramLaneOptions,
): SpectrogramLaneCell => {
  const markers: SpectrogramLaneMarkers = options.markers ?? {};

  const signalCell = createSignalBufferCell(device);
  const sliceSamplesCell = createSpectrogramSliceSamplesCell(
    device,
    markers.sliceSamples,
  );
  const windowingCell = createSpectrogramWindowingCell(
    device,
    markers.windowing,
  );
  const fourierCell = createFourierCell(device, {
    reverse: markers.fourierReverse,
    transform: markers.fourierTransform,
  });
  const magnitudifyCell = createSpectrogramMagnitudifyCell(
    device,
    markers.magnitudify,
  );
  const decibelifyCell = createSpectrogramDecibelifyCell(
    device,
    markers.decibelify,
  );
  const fundamentalFrequencyCell = createSpectrogramFundamentalFrequencyCell(
    device,
    markers.fundamentalFrequency,
  );

  const laneCell = createResourceCell<ExtSpectrogramConfig, SpectrogramLane>({
    create: (config): SpectrogramLane => {
      const signal = signalCell.get({
        windowSize: config.windowSize * config.zeroPaddingFactor,
        windowCount: config.windowCount,
      });
      const sliceSamples = sliceSamplesCell.get({
        out: signal.real,
        config,
      });
      const windowing = windowingCell.get({ signal: signal.real, config });
      const fourier = fourierCell.get({ signal, config });
      const magnitudify = magnitudifyCell.get({ signal, config });
      const decibelify = decibelifyCell.get({ signal: signal.real, config });
      const fundamentalFrequency = fundamentalFrequencyCell.get({
        signal: signal.real,
        config,
      });

      const run = (encoder: GPUCommandEncoder) => {
        sliceSamples.run(encoder);
        encoder.clearBuffer(signal.imag);
        windowing.run(encoder);
        fourier.forward(encoder);
        magnitudify.run(encoder);
        decibelify.run(encoder);
        fundamentalFrequency.run(encoder);
      };

      const skip = (encoder: GPUCommandEncoder, clear: boolean) => {
        if (clear) {
          encoder.clearBuffer(signal.real);
          encoder.clearBuffer(fundamentalFrequency.buffer);
        }
        const emit = (marker?: GPUComputePassTimestampWrites) => {
          if (!marker) {
            return;
          }
          const pass = encoder.beginComputePass({
            label: `${options.label}-lane-skip-pass`,
            timestampWrites: marker,
          });
          pass.end();
        };
        emit(markers.sliceSamples);
        emit(markers.windowing);
        emit(markers.fourierReverse);
        emit(markers.fourierTransform);
        emit(markers.magnitudify);
        emit(markers.decibelify);
        emit(markers.fundamentalFrequency);
      };

      return {
        signal,
        fundamentalFrequencyBuffer: fundamentalFrequency.buffer,
        writeSamples: (samples, trackProgress) => {
          sliceSamples.write(
            samples,
            trackProgress,
            config.lanes[options.label].truncateAfterPlayhead,
          );
        },
        run,
        skip,
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
      current.lanes[options.label].truncateAfterPlayhead ===
        next.lanes[options.label].truncateAfterPlayhead,
  });

  return {
    get: (config) => laneCell.get(config),
    dispose: () => {
      laneCell.dispose();
      fundamentalFrequencyCell.dispose();
      decibelifyCell.dispose();
      magnitudifyCell.dispose();
      fourierCell.dispose();
      windowingCell.dispose();
      sliceSamplesCell.dispose();
      signalCell.dispose();
    },
  };
};
