import { join } from 'node:path';
import { type MessageHandlers } from '@musetric/utils';
import {
  beatThisModel,
  resolveBeatThisModelUrl,
} from '../models/beatThisModel.js';
import { type AnalyzeRhythmMessage } from '../rhythm/analyzeRhythm.node.js';
import {
  ensureCachedModelFile,
  type ModelDownloadMessage,
} from './modelCache.node.js';

export const beatThisCacheDirName = 'beat-this-onnx';

export type BeatThisModelFiles = {
  modelPath: string;
  filterbankPath: string;
};

type EnsureBeatThisModelFilesOptions = {
  modelsPath: string;
  handlers: MessageHandlers<AnalyzeRhythmMessage>;
};

export const ensureBeatThisModelFiles = async (
  options: EnsureBeatThisModelFilesOptions,
): Promise<BeatThisModelFiles> => {
  const { modelsPath, handlers } = options;
  const onDownload = async (message: ModelDownloadMessage): Promise<void> => {
    await handlers.download(message);
  };
  const cacheDir = join(modelsPath, beatThisCacheDirName);
  const paths = new Map<string, string>();
  for (const file of beatThisModel.files) {
    const path = await ensureCachedModelFile({
      label: 'Rhythm analysis model',
      file,
      url: resolveBeatThisModelUrl(file),
      sha256: beatThisModel.sha256[file],
      path: join(cacheDir, file),
      onDownload,
    });
    paths.set(file, path);
  }
  const modelPath = paths.get('beat_this.onnx');
  const filterbankPath = paths.get('mel-filterbank.bin');
  if (!modelPath || !filterbankPath) {
    throw new Error(
      'Beat This! model cache did not contain its complete bundle',
    );
  }
  return { modelPath, filterbankPath };
};
