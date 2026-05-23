import { createResourceCell } from '@musetric/resource-utils';

export type DrawBindGroupArg = {
  arrayView: GPUTextureView;
  leadFundamentalFrequencies: GPUBuffer;
  recordingFundamentalFrequencies: GPUBuffer;
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
          { binding: 3, resource: { buffer: arg.leadFundamentalFrequencies } },
          {
            binding: 4,
            resource: { buffer: arg.recordingFundamentalFrequencies },
          },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.arrayView === next.arrayView &&
      current.leadFundamentalFrequencies === next.leadFundamentalFrequencies &&
      current.recordingFundamentalFrequencies ===
        next.recordingFundamentalFrequencies &&
      current.colors === next.colors &&
      current.layout === next.layout,
  });
