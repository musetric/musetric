import { type ResourceCell } from '@musetric/utils';
import { setOffscreenCanvasSize } from '@musetric/utils/cross/offscreenCanvas';
import {
  allTrackKeys,
  type SpectrogramConfig,
  type TrackKey,
} from '../config.cross.js';
import { createBindGroupCell } from './bindGroup.js';
import { createCanvasCell } from './canvas.js';
import { createColorsCell, drawRingSlotsByteOffset } from './colors.js';

export type SpectrogramDraw = {
  run: (
    encoder: GPUCommandEncoder,
    baseSlots: Record<TrackKey, number>,
  ) => void;
};

export type SpectrogramDrawArg = {
  arrayView: GPUTextureView;
  fundamentalFrequencies: Record<TrackKey, GPUBuffer>;
  config: SpectrogramConfig;
};

export const createSpectrogramDrawCell = (
  device: GPUDevice,
  getMarker?: () => GPUComputePassTimestampWrites | undefined,
): ResourceCell<SpectrogramDrawArg, SpectrogramDraw> => {
  const canvasCell = createCanvasCell(device);
  const colorsCell = createColorsCell(device);
  const sampler = device.createSampler({
    label: 'draw-sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  const bindGroupCell = createBindGroupCell(device, sampler);
  const ringSlotsScratch = new Uint32Array(4);

  return {
    get: (arg) => {
      const { arrayView, fundamentalFrequencies, config } = arg;
      const { reference, target } = config.comparison;
      const canvas = canvasCell.get(config.canvas);
      setOffscreenCanvasSize(config.canvas, config.viewSize);
      const colors = colorsCell.get(config);
      const bindGroup = bindGroupCell.get({
        arrayView,
        referenceFundamentalFrequencies: fundamentalFrequencies[reference],
        targetFundamentalFrequencies: fundamentalFrequencies[target],
        colors: colors.buffer,
        layout: canvas.pipeline.getBindGroupLayout(0),
      });

      return {
        run: (encoder, baseSlots) => {
          ringSlotsScratch[0] = baseSlots[allTrackKeys[0]];
          ringSlotsScratch[1] = baseSlots[allTrackKeys[1]];
          ringSlotsScratch[2] = baseSlots[reference];
          ringSlotsScratch[3] = baseSlots[target];
          device.queue.writeBuffer(
            colors.buffer,
            drawRingSlotsByteOffset,
            ringSlotsScratch,
          );
          const targetView = canvas.context.getCurrentTexture().createView({
            label: 'draw-view',
          });
          const pass = encoder.beginRenderPass({
            label: 'draw-pass',
            colorAttachments: [
              {
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
            timestampWrites: getMarker?.(),
          });
          pass.setPipeline(canvas.pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
        },
      };
    },
    dispose: () => {
      canvasCell.dispose();
      bindGroupCell.dispose();
      colorsCell.dispose();
    },
  };
};
