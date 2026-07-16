import { join } from 'node:path';
import { type MessageHandlers } from '@musetric/utils';
import { type AnalyzeKeyMessage } from '../key/analyzeKey.node.js';
import { resolveSkeyModelUrl, skeyModel } from '../models/skeyModel.js';
import {
  ensureCachedModelFile,
  type ModelDownloadMessage,
} from './modelCache.node.js';

export const skeyCacheDirName = 'skey-onnx';

type EnsureSkeyModelFilesOptions = {
  modelsPath: string;
  handlers: MessageHandlers<AnalyzeKeyMessage>;
};

export const ensureSkeyModelFiles = async (
  options: EnsureSkeyModelFilesOptions,
): Promise<string> => {
  const { modelsPath, handlers } = options;
  const onDownload = async (message: ModelDownloadMessage): Promise<void> => {
    await handlers.download(message);
  };
  const cacheDir = join(modelsPath, skeyCacheDirName);

  let modelPath = '';
  for (const file of skeyModel.files) {
    const path = await ensureCachedModelFile({
      label: 'Key detection model',
      file,
      url: resolveSkeyModelUrl(file),
      sha256: skeyModel.sha256[file],
      path: join(cacheDir, file),
      onDownload,
    });
    if (file.endsWith('.onnx')) {
      modelPath = path;
    }
  }
  return modelPath;
};
