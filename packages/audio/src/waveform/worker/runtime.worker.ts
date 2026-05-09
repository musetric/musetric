import { setOffscreenCanvasSize } from '@musetric/resource-utils/cross/offscreenCanvas';
import { type StemType, stemTypes } from '../../common/stemType.es.js';
import {
  createWaveformProcessor,
  type WaveformProcessor,
} from '../processor.js';
import { type waveformChannel } from '../protocol.cross.js';

export type CreateWaveformRuntimeOptions = {
  port: ReturnType<typeof waveformChannel.inbound<DedicatedWorkerGlobalScope>>;
  getWavePeaks: (
    projectId: number,
    stemType: StemType,
  ) => Promise<Float32Array>;
};

type WaveformItem = {
  canvas: OffscreenCanvas;
  processor: WaveformProcessor;
  wavePeaks?: Float32Array;
  projectId: number;
};

export const createWaveformRuntime = (
  options: CreateWaveformRuntimeOptions,
) => {
  const { port, getWavePeaks } = options;

  const waveformItems: Partial<Record<StemType, WaveformItem>> = {};

  const render = (stemType: StemType): boolean => {
    const item = waveformItems[stemType];
    if (!item || !item.wavePeaks) {
      return false;
    }

    item.processor.render(item.wavePeaks);
    return true;
  };

  const renderAll = () => {
    for (const stemType of stemTypes) {
      render(stemType);
    }
  };

  port.bindHandlers({
    mount: async (message) => {
      try {
        setOffscreenCanvasSize(message.canvas, message.viewSize);
        const item: WaveformItem = {
          canvas: message.canvas,
          processor: createWaveformProcessor(message.canvas, message.colors),
          projectId: message.projectId,
        };
        waveformItems[message.stemType] = item;
        item.wavePeaks = await getWavePeaks(
          message.projectId,
          message.stemType,
        );
        render(message.stemType);
        port.methods.setState({
          stemType: message.stemType,
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to load project waveform', error);
        port.methods.setState({
          stemType: message.stemType,
          status: 'error',
        });
      }
    },
    unmount: (message) => {
      waveformItems[message.stemType] = undefined;
    },
    setColors: (message) => {
      for (const stemType of stemTypes) {
        waveformItems[stemType]?.processor.setColors(message.colors);
      }
      renderAll();
    },
    resize: (message) => {
      const item = waveformItems[message.stemType];
      if (!item) {
        return;
      }

      setOffscreenCanvasSize(item.canvas, message.viewSize);
      render(message.stemType);
    },
  });
};
