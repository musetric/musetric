import { assertDefined, createResourceCell } from '@musetric/utils';
import { createPipeline } from './pipeline.js';

export type CanvasState = {
  context: GPUCanvasContext;
  pipeline: GPURenderPipeline;
};
export const createCanvasCell = (device: GPUDevice) =>
  createResourceCell({
    create: (canvas: OffscreenCanvas): CanvasState => {
      const context = assertDefined(
        canvas.getContext('webgpu'),
        'WebGPU context not available on the canvas',
      );

      return {
        context,
        pipeline: createPipeline(device, context),
      };
    },
    dispose: () => undefined,
    equals: (current, next) => current === next,
  });
