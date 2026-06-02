import { createResourceCell } from '@musetric/resource-utils';
import { createPipeline } from './pipeline.js';

export type CanvasState = {
  context: GPUCanvasContext;
  pipeline: GPURenderPipeline;
};
export const createCanvasCell = (device: GPUDevice) =>
  createResourceCell({
    create: (canvas: OffscreenCanvas): CanvasState => {
      const context = canvas.getContext('webgpu');
      if (!context) {
        throw new Error('WebGPU context not available on the canvas');
      }

      return {
        context,
        pipeline: createPipeline(device, context),
      };
    },
    dispose: () => undefined,
    equals: (current, next) => current === next,
  });
