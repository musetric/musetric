import { createResourceCell } from '@musetric/resource-utils';

export type DrawBindGroupArg = {
  arrayView: GPUTextureView;
  referenceFundamentalFrequencies: GPUBuffer;
  targetFundamentalFrequencies: GPUBuffer;
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
          {
            binding: 3,
            resource: { buffer: arg.referenceFundamentalFrequencies },
          },
          {
            binding: 4,
            resource: { buffer: arg.targetFundamentalFrequencies },
          },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.arrayView === next.arrayView &&
      current.referenceFundamentalFrequencies ===
        next.referenceFundamentalFrequencies &&
      current.targetFundamentalFrequencies ===
        next.targetFundamentalFrequencies &&
      current.colors === next.colors &&
      current.layout === next.layout,
  });
