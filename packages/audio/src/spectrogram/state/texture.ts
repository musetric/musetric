import { createResourceCell } from '@musetric/resource-utils';
import { type ViewSize } from '../../common/viewSize.es.js';

export const spectrogramLayerCount = 2;

export type StateTexture = {
  instance: GPUTexture;
  arrayView: GPUTextureView;
  layerViews: GPUTextureView[];
};
export const createStateTextureCell = (device: GPUDevice) =>
  createResourceCell({
    create: (viewSize: ViewSize): StateTexture => {
      const { width, height } = viewSize;

      const instance = device.createTexture({
        label: 'pipeline-texture',
        size: { width, height, depthOrArrayLayers: spectrogramLayerCount },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.STORAGE_BINDING,
      });

      const arrayView = instance.createView({
        label: 'pipeline-texture-array-view',
        dimension: '2d-array',
        arrayLayerCount: spectrogramLayerCount,
      });
      const layerViews: GPUTextureView[] = [];
      for (let layer = 0; layer < spectrogramLayerCount; layer += 1) {
        layerViews.push(
          instance.createView({
            label: `pipeline-texture-layer-${String(layer)}-view`,
            dimension: '2d',
            baseArrayLayer: layer,
            arrayLayerCount: 1,
          }),
        );
      }

      return {
        instance,
        arrayView,
        layerViews,
      };
    },
    dispose: (texture) => texture.instance.destroy(),
    equals: (current, next) =>
      current.width === next.width && current.height === next.height,
  });
