import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { type SpectrogramConfig } from '../config.cross.js';
import { type SpectrogramBandSpectrum } from '../lane/index.js';

const headerByteLength = 64;
const bandByteLength = 32;
export const slotOffsetByteOffset = 52;
export const columnCountByteOffset = 56;

export type RemapBandParams = {
  windowSize: number;
  halfSize: number;
  minFrequency: number;
  fullMinFrequency: number;
  fullMaxFrequency: number;
  maxFrequency: number;
  inverseReferenceMagnitude: number;
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
  frequencyTiltSlope: number;
  frequencyTiltMinGain: number;
  frequencyTiltMaxGain: number;
  displayGamma: number;
  slotOffset: number;
  columnCount: number;
  bands: RemapBandParams[];
};

export type RemapParamsArg = {
  config: SpectrogramConfig;
  gainDb: number;
  spectra: SpectrogramBandSpectrum[];
};

const toParams = (arg: RemapParamsArg): RemapParams => {
  const { sampleRate, minFrequency, maxFrequency, viewSize, minDecibel } =
    arg.config;
  const { visual } = arg.config;
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
    gateFloorDb: visual.gateFloorDb,
    gateRangeDb: visual.gateRangeDb,
    frequencyTiltSlope: visual.frequencyTiltSlope,
    frequencyTiltMinGain: visual.frequencyTiltMinGain,
    frequencyTiltMaxGain: visual.frequencyTiltMaxGain,
    displayGamma: visual.displayGamma,
    slotOffset: 0,
    columnCount: width,
    bands: arg.spectra.map((spectrum) => ({
      windowSize: spectrum.windowSize,
      halfSize: spectrum.windowSize / 2,
      minFrequency: spectrum.band.minFrequency,
      fullMinFrequency: spectrum.band.fullMinFrequency,
      fullMaxFrequency: spectrum.band.fullMaxFrequency,
      maxFrequency: spectrum.band.maxFrequency,
      inverseReferenceMagnitude: 1 / Math.sqrt(spectrum.windowSize / 2),
    })),
  };
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

export type StateParams = {
  value: RemapParams;
  buffer: GPUBuffer;
  byteLength: number;
  writeRange: (
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => {
    columnCount: number;
    byteOffset: number;
  };
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: RemapParamsArg): StateParams => {
      const value = toParams(arg);
      const byteLength = headerByteLength + value.bands.length * bandByteLength;
      const params = createDynamicUniformParams(device, {
        label: 'remap-params-buffer',
        byteLength,
        capacity: value.width,
      });

      return {
        value,
        buffer: params.buffer,
        byteLength: params.byteLength,
        writeRange: (range) => {
          const columnCount = range ? range.columnCount : value.width;
          const byteOffset = params.write((view) => {
            view.setUint32(0, value.width, true);
            view.setUint32(4, value.height, true);
            view.setFloat32(8, value.sampleRate, true);
            view.setFloat32(12, value.logMinFrequency, true);
            view.setFloat32(16, value.logFrequencyRange, true);
            view.setFloat32(20, value.decibelFactor, true);
            view.setFloat32(24, value.gain, true);
            view.setFloat32(28, value.gateFloorDb, true);
            view.setFloat32(32, value.gateRangeDb, true);
            view.setFloat32(36, value.frequencyTiltSlope, true);
            view.setFloat32(40, value.frequencyTiltMinGain, true);
            view.setFloat32(44, value.frequencyTiltMaxGain, true);
            view.setFloat32(48, value.displayGamma, true);
            view.setUint32(
              slotOffsetByteOffset,
              range ? range.slotOffset : value.slotOffset,
              true,
            );
            view.setUint32(columnCountByteOffset, columnCount, true);
            view.setUint32(60, 0, true);
            value.bands.forEach((band, index) => {
              const offset = headerByteLength + index * bandByteLength;
              view.setFloat32(offset, band.windowSize, true);
              view.setFloat32(offset + 4, band.halfSize, true);
              view.setFloat32(offset + 8, band.minFrequency, true);
              view.setFloat32(offset + 12, band.fullMinFrequency, true);
              view.setFloat32(offset + 16, band.fullMaxFrequency, true);
              view.setFloat32(offset + 20, band.maxFrequency, true);
              view.setFloat32(
                offset + 24,
                band.inverseReferenceMagnitude,
                true,
              );
              view.setFloat32(offset + 28, 0, true);
            });
          });
          return {
            columnCount,
            byteOffset,
          };
        },
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) =>
      current.config.sampleRate === next.config.sampleRate &&
      current.config.minDecibel === next.config.minDecibel &&
      current.config.visual.gateFloorDb === next.config.visual.gateFloorDb &&
      current.config.visual.gateRangeDb === next.config.visual.gateRangeDb &&
      current.config.visual.frequencyTiltSlope ===
        next.config.visual.frequencyTiltSlope &&
      current.config.visual.frequencyTiltMinGain ===
        next.config.visual.frequencyTiltMinGain &&
      current.config.visual.frequencyTiltMaxGain ===
        next.config.visual.frequencyTiltMaxGain &&
      current.config.visual.displayGamma === next.config.visual.displayGamma &&
      current.config.minFrequency === next.config.minFrequency &&
      current.config.maxFrequency === next.config.maxFrequency &&
      current.config.viewSize.width === next.config.viewSize.width &&
      current.config.viewSize.height === next.config.viewSize.height &&
      current.gainDb === next.gainDb &&
      areSpectraEqual(current.spectra, next.spectra),
  });
