import { join } from 'node:path';
import { type MessageHandlers } from '@musetric/utils';
import { type AnalyzeChordsMessage } from '../chords/analyzeChords.node.js';
import {
  chordNetModel,
  resolveChordNetModelUrl,
} from '../models/chordNetModel.js';
import {
  ensureCachedModelFile,
  type ModelDownloadMessage,
} from './modelCache.node.js';

export const chordNetCacheDirName = 'chordmini-onnx';

export type ChordNetModelFiles = {
  modelPath: string;
  planPath: string;
  planManifestPath: string;
};

type EnsureChordNetModelFilesOptions = {
  modelsPath: string;
  handlers: MessageHandlers<AnalyzeChordsMessage>;
};

export const ensureChordNetModelFiles = async (
  options: EnsureChordNetModelFilesOptions,
): Promise<ChordNetModelFiles> => {
  const { modelsPath, handlers } = options;
  const onDownload = async (message: ModelDownloadMessage): Promise<void> => {
    await handlers.download(message);
  };
  const cacheDir = join(modelsPath, chordNetCacheDirName);
  const paths = new Map<string, string>();
  for (const file of chordNetModel.files) {
    const path = await ensureCachedModelFile({
      label: 'Chord recognition model',
      file,
      url: resolveChordNetModelUrl(file),
      sha256: chordNetModel.sha256[file],
      path: join(cacheDir, file),
      onDownload,
    });
    paths.set(file, path);
  }
  const modelPath = paths.get('chordnet.onnx');
  const planPath = paths.get('cqt-plan.bin');
  const planManifestPath = paths.get('cqt-plan.manifest.json');
  if (!modelPath || !planPath || !planManifestPath) {
    throw new Error('ChordNet model cache did not contain its complete bundle');
  }
  return { modelPath, planPath, planManifestPath };
};
