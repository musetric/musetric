import { createResourceCell } from '@musetric/resource-utils';
import { type SpectrogramConfig } from '../config.cross.js';
import { type SpectrogramBandSpectrum } from '../lane/index.js';

export type RemapBandParams = {
  windowSize: number;
  halfSize: number;
  minFrequency: number;
  fullMinFrequency: number;
  fullMaxFrequency: number;
  maxFrequency: number;
};

export type RemapParams = {
  width: number;
  height: number;
  sampleRate: number;
  logMinFrequency: number;
  logFrequencyRange: number;
  decibelFactor: number;
  gain: number;
  gateFloorDb: number;
  gateRangeDb: number;
  bands: RemapBandParams[];
};

export type RemapParamsArg = {
  config: SpectrogramConfig;
  gainDb: number;
  spectra: SpectrogramBandSpectrum[];
};

const gateFloorDb = -64;
const gateRangeDb = 24;
const headerByteLength = 48;
const bandByteLength = 32;

const toParams = (arg: RemapParamsArg): RemapParams => {
  const { sampleRate, minFrequency, maxFrequency, viewSize, minDecibel } =
    arg.config;
  const { width, height } = viewSize;
  const logMinFrequency = Math.log(minFrequency);
  const logFrequencyRange = Math.log(maxFrequency) - logMinFrequency;
  return {
    width,
    height,
    sampleRate,
    logMinFrequency,
    logFrequencyRange,
    decibelFactor: (20 * Math.LOG10E) / -minDecibel,
    gain: 10 ** (arg.gainDb / 20),
    gateFloorDb,
    gateRangeDb,
    bands: arg.spectra.map((spectrum) => ({
      windowSize: spectrum.windowSize,
      halfSize: spectrum.windowSize / 2,
      minFrequency: spectrum.band.minFrequency,
      fullMinFrequency: spectrum.band.fullMinFrequency,
      fullMaxFrequency: spectrum.band.fullMaxFrequency,
      maxFrequency: spectrum.band.maxFrequency,
    })),
  };
};

export type StateParams = {
  value: RemapParams;
  buffer: GPUBuffer;
};

const areSpectraEqual = (
  current: SpectrogramBandSpectrum[],
  next: SpectrogramBandSpectrum[],
) =>
  current.length === next.length &&
  current.every((spectrum, index) => {
    const nextSpectrum = next[index];
    return (
      spectrum.windowSize === nextSpectrum.windowSize &&
      spectrum.band.label === nextSpectrum.band.label &&
      spectrum.band.windowSize === nextSpectrum.band.windowSize &&
      spectrum.band.minFrequency === nextSpectrum.band.minFrequency &&
      spectrum.band.fullMinFrequency === nextSpectrum.band.fullMinFrequency &&
      spectrum.band.fullMaxFrequency === nextSpectrum.band.fullMaxFrequency &&
      spectrum.band.maxFrequency === nextSpectrum.band.maxFrequency
    );
  });

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: RemapParamsArg): StateParams => {
      const value = toParams(arg);
      const array = new DataView(
        new ArrayBuffer(headerByteLength + value.bands.length * bandByteLength),
      );
      array.setUint32(0, value.width, true);
      array.setUint32(4, value.height, true);
      array.setFloat32(8, value.sampleRate, true);
      array.setFloat32(12, value.logMinFrequency, true);
      array.setFloat32(16, value.logFrequencyRange, true);
      array.setFloat32(20, value.decibelFactor, true);
      array.setFloat32(24, value.gain, true);
      array.setFloat32(28, value.gateFloorDb, true);
      array.setFloat32(32, value.gateRangeDb, true);
      value.bands.forEach((band, index) => {
        const offset = headerByteLength + index * bandByteLength;
        array.setFloat32(offset, band.windowSize, true);
        array.setFloat32(offset + 4, band.halfSize, true);
        array.setFloat32(offset + 8, band.minFrequency, true);
        array.setFloat32(offset + 12, band.fullMinFrequency, true);
        array.setFloat32(offset + 16, band.fullMaxFrequency, true);
        array.setFloat32(offset + 20, band.maxFrequency, true);
      });

      const buffer = device.createBuffer({
        label: 'remap-params-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array.buffer);

      return {
        value,
        buffer,
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) =>
      current.config.sampleRate === next.config.sampleRate &&
      current.config.minDecibel === next.config.minDecibel &&
      current.config.minFrequency === next.config.minFrequency &&
      current.config.maxFrequency === next.config.maxFrequency &&
      current.config.viewSize.width === next.config.viewSize.width &&
      current.config.viewSize.height === next.config.viewSize.height &&
      current.gainDb === next.gainDb &&
      areSpectraEqual(current.spectra, next.spectra),
  });
