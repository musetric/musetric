import { createResourceCell } from '@musetric/utils';

export type DrawBindGroupArg = {
  arrayView: GPUTextureView;
  referenceLine: GPUBuffer;
  targetLine: GPUBuffer;
  verdict: GPUBuffer;
  colors: GPUBuffer;
  layout: GPUBindGroupLayout;
};

export const createBindGroupCell = (device: GPUDevice, sampler: GPUSampler) =>
  createResourceCell({
    create: (arg: DrawBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'draw-bind-group',
        layout: arg.layout,
        entries: [
          { binding: 0, resource: { buffer: arg.colors } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: arg.arrayView },
          { binding: 3, resource: { buffer: arg.referenceLine } },
          { binding: 4, resource: { buffer: arg.targetLine } },
          { binding: 5, resource: { buffer: arg.verdict } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.arrayView === next.arrayView &&
      current.referenceLine === next.referenceLine &&
      current.targetLine === next.targetLine &&
      current.verdict === next.verdict &&
      current.colors === next.colors &&
      current.layout === next.layout,
  });
