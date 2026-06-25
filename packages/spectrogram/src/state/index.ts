import { type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createStateTextureCell, type StateTexture } from './texture.js';

export type SpectrogramState = {
  texture: StateTexture;
};
export const createSpectrogramStateCell = (
  device: GPUDevice,
): ResourceCell<ExtSpectrogramConfig, SpectrogramState> => {
  const textureCell = createStateTextureCell(device);

  return {
    get: (config) => {
      const texture = textureCell.get(config.viewSize);
      return {
        texture,
      };
    },
    dispose: () => {
      textureCell.dispose();
    },
  };
};
