import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '../common/complexArray.js';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { windowFunctions } from '../common/windowFunction.js';
import { createPipelines as createDecibelifyPipelines } from '../decibelify/pipeline.js';
import {
  createReversePipeline as createRadix2ReversePipeline,
  createTransformPipeline as createRadix2TransformPipeline,
} from '../fourier/fftRadix2/pipeline.js';
import {
  createReversePipeline as createRadix4ReversePipeline,
  createTransformPipeline as createRadix4TransformPipeline,
} from '../fourier/fftRadix4/pipeline.js';
import { utilsRadix2 } from '../fourier/utilsRadix2.js';
import { utilsRadix4 } from '../fourier/utilsRadix4.js';
import { createPipelines as createFundamentalFrequencyPipelines } from '../fundamentalFrequency/pipeline.js';
import { createPipelines as createMagnitudifyPipelines } from '../magnitudify/pipeline.js';
import { createPipeline as createSliceSamplesPipeline } from '../sliceSamples/pipeline.js';
import { createPipeline as createWindowingPipeline } from '../windowing/pipeline.js';

const workgroupSize = 64;

export type RecordingFundamentalFrequency = {
  buffer: GPUBuffer;
  writeSamples: (samples: Float32Array, trackProgress: number) => void;
  run: (encoder: GPUCommandEncoder) => void;
  skip: (encoder: GPUCommandEncoder, clear: boolean) => void;
  dispose: () => void;
};

const createSignalBuffer = (
  device: GPUDevice,
  paddedWindowSize: number,
  windowCount: number,
): ComplexGpuBuffer => ({
  real: device.createBuffer({
    label: 'recording-signal-real-buffer',
    size: paddedWindowSize * windowCount * Float32Array.BYTES_PER_ELEMENT,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  }),
  imag: device.createBuffer({
    label: 'recording-signal-imag-buffer',
    size: paddedWindowSize * windowCount * Float32Array.BYTES_PER_ELEMENT,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  }),
});

const createRecordingFundamentalFrequency = (
  device: GPUDevice,
  config: ExtSpectrogramConfig,
  marker?: GPUComputePassTimestampWrites,
): RecordingFundamentalFrequency => {
  const paddedWindowSize = config.windowSize * config.zeroPaddingFactor;
  const { windowCount } = config;
  const halfSize = paddedWindowSize / 2;
  const isRadix4 = config.fourierMode === 'fftRadix4';

  const signal = createSignalBuffer(device, paddedWindowSize, windowCount);
  const pipelines = {
    sliceSamples: createSliceSamplesPipeline(device),
    windowing: createWindowingPipeline(device),
    magnitudify: createMagnitudifyPipelines(device),
    decibelify: createDecibelifyPipelines(device),
    fundamentalFrequency: createFundamentalFrequencyPipelines(device),
  };

  const cleanup: GPUBuffer[] = [];

  // sliceSamples resources
  const getSsParams = () => {
    const visibleSamples = Math.ceil(
      config.visibleTime * config.sampleRate + config.windowSize,
    );
    const step = (visibleSamples - config.windowSize) / (windowCount - 1);
    return {
      windowSize: config.windowSize,
      paddedWindowSize,
      windowCount,
      visibleSamples,
      step,
    };
  };
  const ssParams = getSsParams();
  const ssParamsBuffer = device.createBuffer({
    label: 'recording-ss-params',
    size: 20,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  {
    const v = new DataView(new ArrayBuffer(20));
    v.setUint32(0, ssParams.windowSize, true);
    v.setUint32(4, ssParams.paddedWindowSize, true);
    v.setUint32(8, ssParams.windowCount, true);
    v.setUint32(12, ssParams.visibleSamples, true);
    v.setFloat32(16, ssParams.step, true);
    device.queue.writeBuffer(ssParamsBuffer, 0, v.buffer);
  }
  cleanup.push(ssParamsBuffer);

  const visibleSamplesArray = new Float32Array(ssParams.visibleSamples);
  const samplesBuffer = device.createBuffer({
    label: 'recording-samples',
    size: visibleSamplesArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(samplesBuffer, 0, visibleSamplesArray);
  cleanup.push(samplesBuffer);

  const ssBindGroup = device.createBindGroup({
    label: 'recording-ss-bg',
    layout: pipelines.sliceSamples.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: samplesBuffer } },
      { binding: 1, resource: { buffer: signal.real } },
      { binding: 2, resource: { buffer: ssParamsBuffer } },
    ],
  });

  // windowing resources
  const wParams = {
    windowSize: config.windowSize,
    paddedWindowSize,
    windowCount,
  };
  const wParamsBuffer = device.createBuffer({
    label: 'recording-w-params',
    size: 12,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    wParamsBuffer,
    0,
    new Uint32Array([
      wParams.windowSize,
      wParams.paddedWindowSize,
      wParams.windowCount,
    ]),
  );
  cleanup.push(wParamsBuffer);

  const wf = windowFunctions[config.windowName](config.windowSize);
  const wfBuffer = device.createBuffer({
    label: 'recording-wf',
    size: wf.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(wfBuffer, 0, wf);
  cleanup.push(wfBuffer);

  const wBindGroup = device.createBindGroup({
    label: 'recording-w-bg',
    layout: pipelines.windowing.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: wParamsBuffer } },
      { binding: 2, resource: { buffer: wfBuffer } },
    ],
  });

  // FFT resources
  const reverseTable = isRadix4
    ? utilsRadix4.createReverseTable(
        utilsRadix4.getReverseWidth(paddedWindowSize),
      )
    : utilsRadix2.createReverseTable(paddedWindowSize);
  const trigTable = isRadix4
    ? utilsRadix4.createTrigTable(paddedWindowSize)
    : utilsRadix2.createTrigTable(paddedWindowSize);

  const reverseTableBuffer = device.createBuffer({
    label: 'recording-fft-rev-table',
    size: reverseTable.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(reverseTableBuffer, 0, reverseTable);
  cleanup.push(reverseTableBuffer);

  const trigTableBuffer = device.createBuffer({
    label: 'recording-fft-trig-table',
    size: trigTable.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(trigTableBuffer, 0, trigTable);
  cleanup.push(trigTableBuffer);

  const fftPipelines = {
    reverse: isRadix4
      ? createRadix4ReversePipeline(device)
      : createRadix2ReversePipeline(device),
    transform: isRadix4
      ? createRadix4TransformPipeline(device)
      : createRadix2TransformPipeline(device),
  };

  const fftParamsBuffer = device.createBuffer({
    label: 'recording-fft-params',
    size: isRadix4 ? 12 : 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  {
    const arr = isRadix4
      ? new Uint32Array([
          paddedWindowSize,
          windowCount,
          utilsRadix4.getReverseWidth(paddedWindowSize),
        ])
      : new Uint32Array([paddedWindowSize, windowCount]);
    device.queue.writeBuffer(fftParamsBuffer, 0, arr);
  }
  cleanup.push(fftParamsBuffer);

  const ffRevBindGroup = device.createBindGroup({
    label: 'recording-fft-rev-bg',
    layout: fftPipelines.reverse.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: reverseTableBuffer } },
      { binding: 2, resource: { buffer: fftParamsBuffer } },
    ],
  });

  const ffTransBindGroup = device.createBindGroup({
    label: 'recording-fft-trans-bg',
    layout: fftPipelines.transform.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: signal.imag } },
      { binding: 2, resource: { buffer: trigTableBuffer } },
      { binding: 3, resource: { buffer: fftParamsBuffer } },
    ],
  });

  // magnitudify resources
  const mParamsBuffer = device.createBuffer({
    label: 'recording-m-params',
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    mParamsBuffer,
    0,
    new Uint32Array([paddedWindowSize, windowCount]),
  );
  cleanup.push(mParamsBuffer);

  const mBindGroup = device.createBindGroup({
    label: 'recording-m-bg',
    layout: pipelines.magnitudify.layout,
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: signal.imag } },
      { binding: 2, resource: { buffer: mParamsBuffer } },
    ],
  });

  // decibelify resources
  const dParams = {
    halfSize,
    windowCount,
    decibelFactor: (20 * Math.LOG10E) / -config.minDecibel,
  };
  const dParamsBuffer = device.createBuffer({
    label: 'recording-d-params',
    size: 12,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  {
    const v = new DataView(new ArrayBuffer(12));
    v.setUint32(0, dParams.halfSize, true);
    v.setUint32(4, dParams.windowCount, true);
    v.setFloat32(8, dParams.decibelFactor, true);
    device.queue.writeBuffer(dParamsBuffer, 0, v.buffer);
  }
  cleanup.push(dParamsBuffer);

  const dBindGroup = device.createBindGroup({
    label: 'recording-d-bg',
    layout: pipelines.decibelify.layout,
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: dParamsBuffer } },
    ],
  });

  // fundamental frequency resources
  const maxVocalFreq = Math.min(
    1100,
    config.sampleRate * 0.5,
    config.maxFrequency,
  );
  const candidateCount =
    maxVocalFreq > 55
      ? Math.ceil((1200 * Math.log2(maxVocalFreq / 55)) / 10) + 1
      : 0;
  const ffParams = {
    halfSize,
    windowCount,
    windowSize: paddedWindowSize,
    candidateCount,
    sampleRate: config.sampleRate,
    minimumFrequency: 55,
    candidateStepCents: 20,
    minimumFundamentalIntensity: 0.12,
    minimumScore: 0.22,
    harmonicCount: 12,
  };
  const ffParamsBuffer = device.createBuffer({
    label: 'recording-ff-params',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  {
    const v = new DataView(new ArrayBuffer(48));
    v.setUint32(0, ffParams.halfSize, true);
    v.setUint32(4, ffParams.windowCount, true);
    v.setUint32(8, ffParams.windowSize, true);
    v.setUint32(12, ffParams.candidateCount, true);
    v.setFloat32(16, ffParams.sampleRate, true);
    v.setFloat32(20, ffParams.minimumFrequency, true);
    v.setFloat32(24, ffParams.candidateStepCents, true);
    v.setFloat32(28, ffParams.minimumFundamentalIntensity, true);
    v.setFloat32(32, ffParams.minimumScore, true);
    v.setUint32(36, ffParams.harmonicCount, true);
    device.queue.writeBuffer(ffParamsBuffer, 0, v.buffer);
  }
  cleanup.push(ffParamsBuffer);

  const ffRawOutput = device.createBuffer({
    label: 'recording-ff-raw-output',
    size: Math.max(1, windowCount) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    ffRawOutput,
    0,
    new Float32Array(Math.max(1, windowCount)),
  );
  cleanup.push(ffRawOutput);

  const ffFilteredOutput = device.createBuffer({
    label: 'recording-ff-filtered-output',
    size: Math.max(1, windowCount) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    ffFilteredOutput,
    0,
    new Float32Array(Math.max(1, windowCount)),
  );

  const ffDetectBindGroup = device.createBindGroup({
    label: 'recording-ff-detect-bg',
    layout: pipelines.fundamentalFrequency.detect.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: ffRawOutput } },
      { binding: 2, resource: { buffer: ffParamsBuffer } },
    ],
  });

  const ffFilterBindGroup = device.createBindGroup({
    label: 'recording-ff-filter-bg',
    layout: pipelines.fundamentalFrequency.filter.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ffRawOutput } },
      { binding: 1, resource: { buffer: ffFilteredOutput } },
      { binding: 2, resource: { buffer: ffParamsBuffer } },
    ],
  });

  return {
    get buffer() {
      return ffFilteredOutput;
    },
    writeSamples: (samples, trackProgress) => {
      const { windowSize, playheadRatio, sampleRate, visibleTime } = config;
      const beforeSamples =
        visibleTime * playheadRatio * sampleRate + windowSize;
      const totalVisibleSamples = visibleTime * sampleRate + windowSize;
      const startIndex = Math.floor(
        trackProgress * samples.length - beforeSamples,
      );

      const from = Math.max(0, -startIndex);
      const to = Math.min(totalVisibleSamples, samples.length - startIndex);

      if (from > 0) {
        visibleSamplesArray.fill(0, 0, from);
      }
      if (to > from) {
        visibleSamplesArray.set(
          samples.subarray(startIndex + from, startIndex + to),
          from,
        );
      }
      if (to < visibleSamplesArray.length) {
        visibleSamplesArray.fill(0, to, visibleSamplesArray.length);
      }
      device.queue.writeBuffer(samplesBuffer, 0, visibleSamplesArray);
    },
    run: (encoder) => {
      const xCount64 = (n: number) => Math.ceil(n / workgroupSize);
      const halfX = xCount64(halfSize);
      const ffWG = Math.max(1, Math.ceil(windowCount / 64));

      encoder.clearBuffer(signal.imag);

      const pass = encoder.beginComputePass({
        label: 'recording-fundamental-frequency-pass',
        timestampWrites: marker,
      });
      pass.setPipeline(pipelines.sliceSamples);
      pass.setBindGroup(0, ssBindGroup);
      pass.dispatchWorkgroups(xCount64(ssParams.paddedWindowSize), windowCount);

      pass.setPipeline(pipelines.windowing);
      pass.setBindGroup(0, wBindGroup);
      pass.dispatchWorkgroups(xCount64(wParams.windowSize), windowCount);

      pass.setPipeline(fftPipelines.reverse);
      pass.setBindGroup(0, ffRevBindGroup);
      pass.dispatchWorkgroups(windowCount);

      pass.setPipeline(fftPipelines.transform);
      pass.setBindGroup(0, ffTransBindGroup);
      pass.dispatchWorkgroups(windowCount);

      pass.setPipeline(pipelines.magnitudify.run);
      pass.setBindGroup(0, mBindGroup);
      pass.dispatchWorkgroups(halfX, windowCount);
      pass.setPipeline(pipelines.magnitudify.move);
      pass.setBindGroup(0, mBindGroup);
      pass.dispatchWorkgroups(halfX, windowCount);

      pass.setPipeline(pipelines.decibelify.findMax);
      pass.setBindGroup(0, dBindGroup);
      pass.dispatchWorkgroups(windowCount);
      pass.setPipeline(pipelines.decibelify.run);
      pass.setBindGroup(0, dBindGroup);
      pass.dispatchWorkgroups(halfX, windowCount);

      pass.setPipeline(pipelines.fundamentalFrequency.detect);
      pass.setBindGroup(0, ffDetectBindGroup);
      pass.dispatchWorkgroups(ffWG);
      pass.setPipeline(pipelines.fundamentalFrequency.filter);
      pass.setBindGroup(0, ffFilterBindGroup);
      pass.dispatchWorkgroups(ffWG);
      pass.end();
    },
    skip: (encoder, clear) => {
      if (clear) {
        encoder.clearBuffer(ffFilteredOutput);
      }

      if (!marker) {
        return;
      }

      const pass = encoder.beginComputePass({
        label: 'recording-fundamental-frequency-skip-pass',
        timestampWrites: marker,
      });
      pass.end();
    },
    dispose: () => {
      signal.real.destroy();
      signal.imag.destroy();
      ffFilteredOutput.destroy();
      for (const buf of cleanup) {
        buf.destroy();
      }
    },
  };
};

export const createRecordingFundamentalFrequencyCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<ExtSpectrogramConfig, RecordingFundamentalFrequency> =>
  createResourceCell({
    create: (config) =>
      createRecordingFundamentalFrequency(device, config, marker),
    dispose: (recordingFundamentalFrequency) => {
      recordingFundamentalFrequency.dispose();
    },
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
