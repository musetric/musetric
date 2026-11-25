import { createGpuContext } from '@musetric/utils/gpu';
import {
  createSpectrogramProcessor,
  type CreateSpectrogramProcessorOptions,
  type SpectrogramProcessor,
} from '../processor.js';

export const { device } = await createGpuContext();

export const withProcessor = async <T>(
  options: CreateSpectrogramProcessorOptions,
  fn: (processor: SpectrogramProcessor) => Promise<T>,
): Promise<T> => {
  const processor = createSpectrogramProcessor(options);
  try {
    return await fn(processor);
  } finally {
    processor.dispose();
  }
};
