import { createResourceCell } from '@musetric/utils';
import { columnsShader } from './columns.wgsl.js';

const workgroupSize = 64;

export type DrawColumnsArg = {
  width: number;
  colors: GPUBuffer;
  referenceLine: GPUBuffer;
  targetLine: GPUBuffer;
};

export type DrawColumns = {
  buffer: GPUBuffer;
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export const createColumnsCell = (device: GPUDevice) => {
  const pipeline = device.createComputePipeline({
    label: 'draw-columns-pipeline',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        label: 'draw-columns-shader',
        code: columnsShader,
      }),
      entryPoint: 'main',
    },
  });
  return createResourceCell({
    create: (arg: DrawColumnsArg): DrawColumns => {
      const buffer = device.createBuffer({
        label: 'draw-columns-buffer',
        size: arg.width * 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      });
      const bindGroup = device.createBindGroup({
        label: 'draw-columns-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.colors } },
          { binding: 1, resource: { buffer: arg.referenceLine } },
          { binding: 2, resource: { buffer: arg.targetLine } },
          { binding: 3, resource: { buffer } },
        ],
      });
      return {
        buffer,
        dispatch: (pass) => {
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(arg.width / workgroupSize));
        },
      };
    },
    dispose: (columns) => {
      columns.buffer.destroy();
    },
    equals: (current, next) =>
      current.width === next.width &&
      current.colors === next.colors &&
      current.referenceLine === next.referenceLine &&
      current.targetLine === next.targetLine,
  });
};
