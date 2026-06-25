import { type ViewSize, waveformVisualPeakCeilingDb } from '@musetric/utils';
import { setOffscreenCanvasSize } from '@musetric/utils/cross/offscreenCanvas';
import { type StemType, stemTypes } from '../../common/stemType.es.js';
import { type WaveformColors } from '../colors.es.js';
import {
  createWaveformProcessor,
  type WaveformProcessor,
} from '../processor.js';
import { type waveformChannel } from '../protocol.cross.js';

export type CreateWaveformRuntimeOptions = {
  port: ReturnType<typeof waveformChannel.inbound<DedicatedWorkerGlobalScope>>;
  getDeliveryWavePeaks: (
    projectId: number,
    stemType: StemType,
  ) => Promise<Float32Array>;
  getRecordingWavePeaks: (projectId: number) => Promise<Float32Array>;
};

type WaveformItem = {
  canvas: OffscreenCanvas;
  processor: WaveformProcessor;
  wavePeaks?: Float32Array;
  projectId: number;
  frameCount: number;
};

export const createWaveformRuntime = (
  options: CreateWaveformRuntimeOptions,
) => {
  const { port, getDeliveryWavePeaks, getRecordingWavePeaks } = options;

  const deliveryWaveformItems: Partial<Record<StemType, WaveformItem>> = {};
  let recordingWaveformItem: WaveformItem | undefined = undefined;
  let sourceGainDb = 0;

  const dbToGain = (db: number) => 10 ** (db / 20);
  const amplitudeToDb = (amplitude: number) => 20 * Math.log10(amplitude);

  const getWavePeaksMax = (wavePeaks: Float32Array): number => {
    let max = 0;
    for (let i = 0; i < wavePeaks.length; i += 1) {
      max = Math.max(max, Math.abs(wavePeaks[i]));
    }
    return max;
  };

  const getDeliveryPeakMax = (): number => {
    let max = 0;
    for (const stemType of stemTypes) {
      const wavePeaks = deliveryWaveformItems[stemType]?.wavePeaks;
      if (wavePeaks) {
        max = Math.max(max, getWavePeaksMax(wavePeaks));
      }
    }
    return max;
  };

  const getLimitedSourceGainDb = (): number => {
    const peakMax = getDeliveryPeakMax();
    if (peakMax <= 0) {
      return sourceGainDb;
    }
    return Math.min(
      sourceGainDb,
      waveformVisualPeakCeilingDb - amplitudeToDb(peakMax),
    );
  };

  const renderItem = (item: WaveformItem | undefined, gain = 1): boolean => {
    if (!item || !item.wavePeaks) {
      return false;
    }

    item.processor.render(item.wavePeaks, gain);
    return true;
  };

  const renderDeliveryItem = (item: WaveformItem | undefined): boolean =>
    renderItem(item, dbToGain(getLimitedSourceGainDb()));

  const renderDeliveryItems = () => {
    for (const stemType of stemTypes) {
      renderDeliveryItem(deliveryWaveformItems[stemType]);
    }
  };

  const renderAll = () => {
    renderDeliveryItems();
    renderItem(recordingWaveformItem);
  };

  const reloadDelivery = async (stemType: StemType): Promise<void> => {
    const item = deliveryWaveformItems[stemType];
    if (!item) {
      return;
    }
    item.wavePeaks = await getDeliveryWavePeaks(item.projectId, stemType);
    renderDeliveryItems();
  };

  const reloadRecording = async (): Promise<void> => {
    const item = recordingWaveformItem;
    if (!item) {
      return;
    }
    item.wavePeaks = await getRecordingWavePeaks(item.projectId);
    renderItem(item);
  };

  const createWaveformItem = (message: {
    canvas: OffscreenCanvas;
    colors: WaveformColors;
    viewSize: ViewSize;
    projectId: number;
    frameCount: number;
  }): WaveformItem => {
    setOffscreenCanvasSize(message.canvas, message.viewSize);
    return {
      canvas: message.canvas,
      processor: createWaveformProcessor(message.canvas, message.colors),
      projectId: message.projectId,
      frameCount: message.frameCount,
    };
  };

  port.bindHandlers({
    mountDelivery: async (message) => {
      try {
        deliveryWaveformItems[message.stemType] = createWaveformItem(message);
        await reloadDelivery(message.stemType);
        port.methods.setDeliveryState({
          stemType: message.stemType,
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to load project waveform', error);
        port.methods.setDeliveryState({
          stemType: message.stemType,
          status: 'error',
        });
      }
    },
    mountRecording: async (message) => {
      try {
        recordingWaveformItem = createWaveformItem(message);
        await reloadRecording();
        port.methods.setRecordingState({
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to load recording waveform', error);
        port.methods.setRecordingState({
          status: 'error',
        });
      }
    },
    unmountDelivery: (message) => {
      deliveryWaveformItems[message.stemType] = undefined;
    },
    unmountRecording: () => {
      recordingWaveformItem = undefined;
    },
    setColors: (message) => {
      for (const stemType of stemTypes) {
        deliveryWaveformItems[stemType]?.processor.setColors(message.colors);
      }
      recordingWaveformItem?.processor.setColors(message.colors);
      renderAll();
    },
    setSourceGainDb: (message) => {
      sourceGainDb = message.gainDb;
      renderDeliveryItems();
    },
    resizeDelivery: (message) => {
      const item = deliveryWaveformItems[message.stemType];
      if (!item) {
        return;
      }

      setOffscreenCanvasSize(item.canvas, message.viewSize);
      renderDeliveryItem(item);
    },
    resizeRecording: (message) => {
      const item = recordingWaveformItem;
      if (!item) {
        return;
      }

      setOffscreenCanvasSize(item.canvas, message.viewSize);
      renderItem(item);
    },
    refreshDelivery: async (message) => {
      try {
        await reloadDelivery(message.stemType);
        port.methods.setDeliveryState({
          stemType: message.stemType,
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to refresh project waveform', error);
        port.methods.setDeliveryState({
          stemType: message.stemType,
          status: 'error',
        });
      }
    },
    refreshRecording: async () => {
      try {
        await reloadRecording();
        port.methods.setRecordingState({
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to refresh recording waveform', error);
        port.methods.setRecordingState({
          status: 'error',
        });
      }
    },
    applyRecordingPeakPatch: (message) => {
      const item = recordingWaveformItem;
      if (!item?.wavePeaks) {
        return;
      }

      item.wavePeaks.set(message.peaks, message.startPeakIndex * 2);
      renderItem(item);
    },
  });
};
