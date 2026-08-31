import {
  createWhisperRuntime,
  type PayloadSegment,
  runTranscription,
} from '@musetric/ai/dom';
import { decodeMonoAudio } from '../analysis/index.js';
import { waitForGpuHeadroom } from '../app/waitForGpuHeadroom.js';
import { type ModelProgressHandler, type ModelStore } from '../models/index.js';

const sampleRate = 16000;

export type TranscribeTrackOptions = {
  source: ArrayBuffer;
  models: ModelStore;
  onModelProgress: ModelProgressHandler;
  onProgress: (stage: string, fraction?: number) => void;
};

export const transcribeTrack = async (
  options: TranscribeTrackOptions,
): Promise<PayloadSegment[]> => {
  const { models, onModelProgress, onProgress, source } = options;
  onProgress('Decoding audio for transcription');
  const audio = await decodeMonoAudio(source.slice(0), sampleRate);
  onProgress('Downloading Whisper transcription model');
  const model = await models.ensureWhisperModel(onModelProgress);
  const transcribeWith = async (): Promise<PayloadSegment[]> => {
    await waitForGpuHeadroom({
      activity: 'Whisper loading',
      onProgress,
    });
    onProgress('Loading Whisper on GPU', 0);
    const runtime = await createWhisperRuntime({
      ...model,
      onLoadProgress: (fraction) => {
        onProgress('Loading Whisper on GPU', fraction);
      },
    });
    try {
      await waitForGpuHeadroom({
        activity: 'Whisper transcription',
        onProgress,
      });
      onProgress('Transcribing lyrics on GPU', 0);
      const transcript = await runTranscription({
        audio,
        detectLanguage: runtime.detectLanguage,
        transcribeBatch: runtime.transcribeBatch,
        transcribeAligned: runtime.transcribeAligned,
        onProgress: (fraction) => {
          onProgress('Transcribing lyrics on GPU', fraction);
        },
      });
      onProgress('Transcribing lyrics on GPU', 1);
      return transcript;
    } finally {
      await runtime.release();
    }
  };
  return await transcribeWith();
};
