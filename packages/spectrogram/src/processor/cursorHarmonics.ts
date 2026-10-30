import {
  allTrackKeys,
  mapTrackKeys,
  type TrackKey,
} from '../common/trackKeys.es.js';
import {
  areHarmonicsShown,
  type SpectrogramCursorHarmonics,
} from '../config.cross.js';
import { type SpectrogramRuntime } from '../configurator.js';
import { type TrackRenderPlan } from './renderPlan.js';

const trackSize = Uint32Array.BYTES_PER_ELEMENT * 2;

const encodeCursorCopies = (
  encoder: GPUCommandEncoder,
  target: GPUBuffer,
  runtime: SpectrogramRuntime,
  plans: Record<TrackKey, TrackRenderPlan>,
) => {
  const { windowCount, playheadRatio } = runtime.config;
  const cursorColumn = Math.min(
    windowCount - 1,
    Math.floor(playheadRatio * windowCount),
  );
  allTrackKeys.forEach((key, index) => {
    const slot = (plans[key].baseSlot + cursorColumn) % windowCount;
    const targetOffset = index * trackSize;
    encoder.copyBufferToBuffer(
      runtime.tracks[key].lane.fundamentalLineBuffer,
      slot * Uint32Array.BYTES_PER_ELEMENT,
      target,
      targetOffset,
      Uint32Array.BYTES_PER_ELEMENT,
    );
    encoder.copyBufferToBuffer(
      runtime.draw.dominantHarmonics,
      (index * windowCount + slot) * Uint32Array.BYTES_PER_ELEMENT,
      target,
      targetOffset + Uint32Array.BYTES_PER_ELEMENT,
      Uint32Array.BYTES_PER_ELEMENT,
    );
  });
};

export const createCursorHarmonicsReader = (device: GPUDevice) => {
  const buffer = device.createBuffer({
    label: 'cursor-harmonics-read-buffer',
    size: trackSize * allTrackKeys.length,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  let reading = false;

  return {
    read: async (
      runtime: SpectrogramRuntime,
      plans: Record<TrackKey, TrackRenderPlan>,
    ): Promise<SpectrogramCursorHarmonics | undefined> => {
      if (!areHarmonicsShown(runtime.config) || reading) {
        return undefined;
      }
      const encoder = device.createCommandEncoder({
        label: 'cursor-harmonics-encoder',
      });
      encodeCursorCopies(encoder, buffer, runtime, plans);
      device.queue.submit([encoder.finish()]);
      reading = true;
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = buffer.getMappedRange();
        const fundamentals = new Float32Array(bytes);
        const dominants = new Uint32Array(bytes);
        const harmonics = mapTrackKeys((_, index) => ({
          fundamental: fundamentals[index * 2],
          dominant: dominants[index * 2 + 1],
        }));
        buffer.unmap();
        return harmonics;
      } finally {
        reading = false;
      }
    },
    dispose: () => {
      buffer.destroy();
    },
  };
};
