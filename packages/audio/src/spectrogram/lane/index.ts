import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '../common/complexArray.js';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createSpectrogramDecibelifyCell } from '../decibelify/index.js';
import { createFourierCell } from '../fourier/cell.js';
import { createSpectrogramFundamentalFrequencyCell } from '../fundamentalFrequency/index.js';
import { createSpectrogramMagnitudifyCell } from '../magnitudify/index.js';
import { createSpectrogramSliceSamplesCell } from '../sliceSamples/index.js';
import { createSignalBufferCell } from '../state/signal.js';
import { createSpectrogramWindowingCell } from '../windowing/index.js';

export type GranularLaneMarkers = {
  sliceSamples?: GPUComputePassTimestampWrites;
  windowing?: GPUComputePassTimestampWrites;
  fourierReverse?: GPUComputePassTimestampWrites;
  fourierTransform?: GPUComputePassTimestampWrites;
  magnitudify?: GPUComputePassTimestampWrites;
  decibelify?: GPUComputePassTimestampWrites;
  fundamentalFrequency?: GPUComputePassTimestampWrites;
};

export type SpectrogramLanePolicy =
  | {
      mode: 'granular';
      label: string;
      markers: GranularLaneMarkers;
    }
  | {
      mode: 'bulk';
      label: string;
      marker?: GPUComputePassTimestampWrites;
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
  policy: SpectrogramLanePolicy,
): SpectrogramLaneCell => {
  const granularMarkers: GranularLaneMarkers =
    policy.mode === 'granular' ? policy.markers : {};
  const bulkMarker = policy.mode === 'bulk' ? policy.marker : undefined;

  const signalCell = createSignalBufferCell(device);
  const sliceSamplesCell = createSpectrogramSliceSamplesCell(
    device,
    granularMarkers.sliceSamples,
  );
  const windowingCell = createSpectrogramWindowingCell(
    device,
    granularMarkers.windowing,
  );
  const fourierCell = createFourierCell(device, {
    reverse: granularMarkers.fourierReverse,
    transform: granularMarkers.fourierTransform,
  });
  const magnitudifyCell = createSpectrogramMagnitudifyCell(
    device,
    granularMarkers.magnitudify,
  );
  const decibelifyCell = createSpectrogramDecibelifyCell(
    device,
    granularMarkers.decibelify,
  );
  const fundamentalFrequencyCell = createSpectrogramFundamentalFrequencyCell(
    device,
    granularMarkers.fundamentalFrequency,
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

      const runGranular = (encoder: GPUCommandEncoder) => {
        sliceSamples.run(encoder);
        encoder.clearBuffer(signal.imag);
        windowing.run(encoder);
        fourier.forward(encoder);
        magnitudify.run(encoder);
        decibelify.run(encoder);
        fundamentalFrequency.run(encoder);
      };

      const runBulk = (encoder: GPUCommandEncoder) => {
        encoder.clearBuffer(signal.imag);
        const pass = encoder.beginComputePass({
          label: `${policy.label}-lane-pass`,
          timestampWrites: bulkMarker,
        });
        sliceSamples.dispatch(pass);
        windowing.dispatch(pass);
        fourier.forwardDispatch(pass);
        magnitudify.dispatch(pass);
        decibelify.dispatch(pass);
        fundamentalFrequency.dispatch(pass);
        pass.end();
      };

      const skipGranular = (encoder: GPUCommandEncoder, clear: boolean) => {
        if (clear) {
          encoder.clearBuffer(signal.real);
          encoder.clearBuffer(fundamentalFrequency.buffer);
        }
        const emit = (marker?: GPUComputePassTimestampWrites) => {
          if (!marker) {
            return;
          }
          const pass = encoder.beginComputePass({
            label: `${policy.label}-lane-skip-pass`,
            timestampWrites: marker,
          });
          pass.end();
        };
        emit(granularMarkers.sliceSamples);
        emit(granularMarkers.windowing);
        emit(granularMarkers.fourierReverse);
        emit(granularMarkers.fourierTransform);
        emit(granularMarkers.magnitudify);
        emit(granularMarkers.decibelify);
        emit(granularMarkers.fundamentalFrequency);
      };
      const skipBulk = (encoder: GPUCommandEncoder, clear: boolean) => {
        if (clear) {
          encoder.clearBuffer(signal.real);
          encoder.clearBuffer(fundamentalFrequency.buffer);
        }
        if (bulkMarker) {
          const pass = encoder.beginComputePass({
            label: `${policy.label}-lane-skip-pass`,
            timestampWrites: bulkMarker,
          });
          pass.end();
        }
      };

      return {
        signal,
        fundamentalFrequencyBuffer: fundamentalFrequency.buffer,
        writeSamples: sliceSamples.write,
        run: policy.mode === 'granular' ? runGranular : runBulk,
        skip: policy.mode === 'granular' ? skipGranular : skipBulk,
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
      current.windowCount === next.windowCount,
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
