import { join } from 'node:path';
import { type MessageHandlers } from '@musetric/utils';
import {
  resolveWhisperModelUrl,
  whisperModel,
} from '../models/whisperModel.js';
import { type TranscribeAudioMessage } from '../transcription/transcribeAudio.node.js';
import {
  ensureCachedModelFile,
  type ModelDownloadMessage,
} from './modelCache.node.js';

export const whisperCacheDirName = 'whisper-onnx-hf-cache';

type EnsureWhisperModelFilesOptions = {
  modelsPath: string;
  handlers: MessageHandlers<TranscribeAudioMessage>;
};

export const ensureWhisperModelFiles = async (
  options: EnsureWhisperModelFilesOptions,
): Promise<void> => {
  const { modelsPath, handlers } = options;
  const onDownload = async (message: ModelDownloadMessage): Promise<void> => {
    await handlers.download(message);
  };
  const cacheDir = join(modelsPath, whisperCacheDirName);
  const modelDir = join(
    cacheDir,
    whisperModel.modelId,
    'resolve',
    whisperModel.revision,
  );

  for (const file of whisperModel.files) {
    await ensureCachedModelFile({
      label: 'Whisper transcription model',
      file,
      url: resolveWhisperModelUrl(file),
      sha256: whisperModel.sha256[file],
      path: join(modelDir, file),
      onDownload,
    });
  }
};
