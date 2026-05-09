import { type ResourceCell } from '@musetric/resource-utils';
import { setOffscreenCanvasSize } from '@musetric/resource-utils/cross/offscreenCanvas';
import { type SpectrogramConfig } from '../config.cross.js';
import { createBindGroupCell } from './bindGroup.js';
import { createCanvasCell } from './canvas.js';
import { createColorsCell } from './colors.js';

export type SpectrogramDraw = {
  run: (encoder: GPUCommandEncoder) => void;
};

export type SpectrogramDrawArg = {
  view: GPUTextureView;
  config: SpectrogramConfig;
};

export const createSpectrogramDrawCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<SpectrogramDrawArg, SpectrogramDraw> => {
  const canvasCell = createCanvasCell(device);
  const colorsCell = createColorsCell(device);
  const sampler = device.createSampler({
    label: 'draw-sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  const bindGroupCell = createBindGroupCell(device, sampler);

  return {
    get: (arg) => {
      const { view, config } = arg;
      const canvas = canvasCell.get(config.canvas);
      setOffscreenCanvasSize(config.canvas, config.viewSize);
      const colors = colorsCell.get(config);
      const bindGroup = bindGroupCell.get({
        view,
        colors: colors.buffer,
        layout: canvas.pipeline.getBindGroupLayout(0),
      });

      return {
        run: (encoder) => {
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
            timestampWrites: marker,
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
