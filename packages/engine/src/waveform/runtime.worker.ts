import {
  type StemType,
  stemTypes,
  type WaveformColors,
} from '@musetric/audio/es';
import {
  createWaveformProcessor,
  type WaveformProcessor,
} from '@musetric/audio/waveform';
import { type ViewSize, waveformVisualPeakCeilingDb } from '@musetric/utils';
import { setOffscreenCanvasSize } from '@musetric/utils/cross/offscreenCanvas';
import {
  getMasterWave,
  getRecordingAudioWave,
} from '../audioRequest/audioRequest.worker.js';
import { type waveformChannel } from './protocol.cross.js';

export type CreateWaveformRuntimeOptions = {
  port: ReturnType<typeof waveformChannel.inbound<DedicatedWorkerGlobalScope>>;
};

type WaveformItem = {
  canvas: OffscreenCanvas;
  processor: WaveformProcessor;
  wavePeaks?: Float32Array;
  projectId: number;
  recordingId?: number;
  frameCount: number;
};

export const createWaveformRuntime = (
  options: CreateWaveformRuntimeOptions,
) => {
  const { port } = options;

  const stemWaveformItems: Partial<Record<StemType, WaveformItem>> = {};
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

  const getStemPeakMax = (): number => {
    let max = 0;
    for (const stemType of stemTypes) {
      const wavePeaks = stemWaveformItems[stemType]?.wavePeaks;
      if (wavePeaks) {
        max = Math.max(max, getWavePeaksMax(wavePeaks));
      }
    }
    return max;
  };

  const getLimitedSourceGainDb = (): number => {
    const peakMax = getStemPeakMax();
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

  const renderStemItem = (item: WaveformItem | undefined): boolean =>
    renderItem(item, dbToGain(getLimitedSourceGainDb()));

  const renderStemItems = () => {
    for (const stemType of stemTypes) {
      renderStemItem(stemWaveformItems[stemType]);
    }
  };

  const renderAll = () => {
    renderStemItems();
    renderItem(recordingWaveformItem);
  };

  const reloadStem = async (stemType: StemType): Promise<void> => {
    const item = stemWaveformItems[stemType];
    if (!item) {
      return;
    }
    item.wavePeaks = await getMasterWave(item.projectId, stemType);
    renderStemItems();
  };

  const reloadRecording = async (): Promise<void> => {
    const item = recordingWaveformItem;
    const recordingId = item?.recordingId;
    if (!item || recordingId === undefined) {
      return;
    }
    const wavePeaks = await getRecordingAudioWave(item.projectId, recordingId);
    if (recordingWaveformItem !== item || item.recordingId !== recordingId) {
      return;
    }
    item.wavePeaks = wavePeaks;
    renderItem(item);
  };

  const refreshRecording = async (): Promise<void> => {
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
  };

  type CreateWaveformItemMessage = {
    canvas: OffscreenCanvas;
    colors: WaveformColors;
    viewSize: ViewSize;
    projectId: number;
    frameCount: number;
  };

  const createWaveformItem = (
    message: CreateWaveformItemMessage,
  ): WaveformItem => {
    setOffscreenCanvasSize(message.canvas, message.viewSize);
    return {
      canvas: message.canvas,
      processor: createWaveformProcessor(message.canvas, message.colors),
      projectId: message.projectId,
      frameCount: message.frameCount,
    };
  };

  port.bindHandlers({
    mountStem: async (message) => {
      try {
        stemWaveformItems[message.stemType] = createWaveformItem(message);
        await reloadStem(message.stemType);
        port.methods.setStemState({
          stemType: message.stemType,
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to load project waveform', error);
        port.methods.setStemState({
          stemType: message.stemType,
          status: 'error',
        });
      }
    },
    mountRecording: async (message) => {
      try {
        recordingWaveformItem = {
          ...createWaveformItem(message),
          recordingId: message.recordingId,
        };
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
    unmountStem: (message) => {
      stemWaveformItems[message.stemType] = undefined;
    },
    unmountRecording: () => {
      recordingWaveformItem = undefined;
    },
    setColors: (message) => {
      for (const stemType of stemTypes) {
        stemWaveformItems[stemType]?.processor.setColors(message.colors);
      }
      recordingWaveformItem?.processor.setColors(message.colors);
      renderAll();
    },
    setSourceGainDb: (message) => {
      sourceGainDb = message.gainDb;
      renderStemItems();
    },
    resizeStem: (message) => {
      const item = stemWaveformItems[message.stemType];
      if (!item) {
        return;
      }

      setOffscreenCanvasSize(item.canvas, message.viewSize);
      renderStemItem(item);
    },
    resizeRecording: (message) => {
      const item = recordingWaveformItem;
      if (!item) {
        return;
      }

      setOffscreenCanvasSize(item.canvas, message.viewSize);
      renderItem(item);
    },
    refreshStem: async (message) => {
      try {
        await reloadStem(message.stemType);
        port.methods.setStemState({
          stemType: message.stemType,
          status: 'success',
        });
      } catch (error) {
        console.error('Failed to refresh project waveform', error);
        port.methods.setStemState({
          stemType: message.stemType,
          status: 'error',
        });
      }
    },
    refreshRecording,
    setRecording: async (message) => {
      const item = recordingWaveformItem;
      if (!item || item.recordingId === message.recordingId) {
        return;
      }
      item.recordingId = message.recordingId;
      await refreshRecording();
    },
    applyRecordingPeakPatch: (message) => {
      const item = recordingWaveformItem;
      if (!item?.wavePeaks || item.recordingId !== message.recordingId) {
        return;
      }

      item.wavePeaks.set(message.peaks, message.startPeakIndex * 2);
      renderItem(item);
    },
  });
};
