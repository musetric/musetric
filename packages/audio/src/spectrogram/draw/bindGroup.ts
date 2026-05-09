import { createResourceCell } from '@musetric/resource-utils';

export type DrawBindGroupArg = {
  view: GPUTextureView;
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
          { binding: 2, resource: arg.view },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.view === next.view &&
      current.colors === next.colors &&
      current.layout === next.layout,
  });
