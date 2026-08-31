import {
  beatThisModel,
  chordNetModel,
  leadBackingModel,
  resolveBeatThisModelUrl,
  resolveChordNetModelUrl,
  resolveSkeyModelUrl,
  resolveVocalsModelUrl,
  resolveWhisperModelUrl,
  skeyModel,
  vocalsModel,
  whisperModel,
} from '@musetric/ai/dom';
import { type StorageClient } from '../storage/index.js';

type ModelBundle = {
  label: string;
  cacheDirName: string;
  files: readonly string[];
  sha256: Readonly<Record<string, string>>;
  resolveUrl: (file: string) => string;
};

const chordNetBundle: ModelBundle = {
  label: 'Chord recognition model',
  cacheDirName: chordNetModel.cacheDirName,
  files: chordNetModel.files,
  sha256: chordNetModel.sha256,
  resolveUrl: resolveChordNetModelUrl,
};

const skeyBundle: ModelBundle = {
  label: 'Key detection model',
  cacheDirName: skeyModel.cacheDirName,
  files: skeyModel.files,
  sha256: skeyModel.sha256,
  resolveUrl: resolveSkeyModelUrl,
};

const beatThisBundle: ModelBundle = {
  label: 'Rhythm analysis model',
  cacheDirName: beatThisModel.cacheDirName,
  files: beatThisModel.files,
  sha256: beatThisModel.sha256,
  resolveUrl: resolveBeatThisModelUrl,
};

const vocalsBundle: ModelBundle = {
  label: 'Vocal separation model',
  cacheDirName: 'vocals',
  files: [vocalsModel.files.model, vocalsModel.files.data],
  sha256: {
    [vocalsModel.files.model]: vocalsModel.sha256.model,
    [vocalsModel.files.data]: vocalsModel.sha256.data,
  },
  resolveUrl: resolveVocalsModelUrl,
};

const leadBackingBundle: ModelBundle = {
  label: 'Lead and backing model',
  cacheDirName: 'lead-backing',
  files: [leadBackingModel.file],
  sha256: { [leadBackingModel.file]: leadBackingModel.sha256 },
  resolveUrl: () => leadBackingModel.sourceUrl,
};

export type ModelProgress = {
  label: string;
  file: string;
  downloaded: number;
  total?: number;
  cached: boolean;
};

export type ModelProgressHandler = (progress: ModelProgress) => void;

export type ChordNetModelFiles = {
  modelUrl: string;
  planUrl: string;
  planManifestUrl: string;
};

export type BeatThisModelFiles = {
  modelUrl: string;
  filterbankUrl: string;
};

export type VocalsModelFiles = {
  modelUrl: string;
  modelDataUrl: string;
  modelDataPath: string;
};

export type LeadBackingModelFiles = {
  modelUrl: string;
};

export type WhisperModelFiles = {
  modelHost: string;
  modelId: string;
  revision: string;
};

export type ModelStore = {
  ensureChordNetModel: (
    onProgress?: ModelProgressHandler,
  ) => Promise<ChordNetModelFiles>;
  ensureSkeyModel: (onProgress?: ModelProgressHandler) => Promise<string>;
  ensureBeatThisModel: (
    onProgress?: ModelProgressHandler,
  ) => Promise<BeatThisModelFiles>;
  ensureVocalsModel: (
    onProgress?: ModelProgressHandler,
  ) => Promise<VocalsModelFiles>;
  ensureLeadBackingModel: (
    onProgress?: ModelProgressHandler,
  ) => Promise<LeadBackingModelFiles>;
  ensureWhisperModel: (
    onProgress?: ModelProgressHandler,
  ) => Promise<WhisperModelFiles>;
};

export const createModelStore = (storage: StorageClient): ModelStore => {
  const ensureBundle = async (
    bundle: ModelBundle,
    onProgress?: ModelProgressHandler,
  ): Promise<Map<string, string>> => {
    const urls = new Map<string, string>();
    for (const file of bundle.files) {
      const path = `models/${bundle.cacheDirName}/${file}`;
      await storage.downloadFile({
        url: bundle.resolveUrl(file),
        path,
        sha256: bundle.sha256[file],
        onProgress: (progress) => {
          onProgress?.({ label: bundle.label, file, ...progress });
        },
      });
      urls.set(file, storage.fileUrl(path));
    }
    return urls;
  };

  const requireFile = (urls: Map<string, string>, file: string): string => {
    const url = urls.get(file);
    if (url === undefined) {
      throw new Error(`Model bundle is missing ${file}`);
    }
    return url;
  };

  return {
    ensureChordNetModel: async (onProgress) => {
      const urls = await ensureBundle(chordNetBundle, onProgress);
      return {
        modelUrl: requireFile(urls, 'chordnet.onnx'),
        planUrl: requireFile(urls, 'cqt-plan.bin'),
        planManifestUrl: requireFile(urls, 'cqt-plan.manifest.json'),
      };
    },
    ensureSkeyModel: async (onProgress) => {
      const urls = await ensureBundle(skeyBundle, onProgress);
      return requireFile(urls, 'skey.onnx');
    },
    ensureBeatThisModel: async (onProgress) => {
      const urls = await ensureBundle(beatThisBundle, onProgress);
      return {
        modelUrl: requireFile(urls, 'beat_this.onnx'),
        filterbankUrl: requireFile(urls, 'mel-filterbank.bin'),
      };
    },
    ensureVocalsModel: async (onProgress) => {
      const urls = await ensureBundle(vocalsBundle, onProgress);
      return {
        modelUrl: requireFile(urls, vocalsModel.files.model),
        modelDataUrl: requireFile(urls, vocalsModel.files.data),
        modelDataPath: vocalsModel.files.data,
      };
    },
    ensureLeadBackingModel: async (onProgress) => {
      const urls = await ensureBundle(leadBackingBundle, onProgress);
      return { modelUrl: requireFile(urls, leadBackingModel.file) };
    },
    ensureWhisperModel: async (onProgress) => {
      for (const file of whisperModel.files) {
        const path = `models/${whisperModel.modelId}/resolve/${whisperModel.revision}/${file}`;
        await storage.downloadFile({
          url: resolveWhisperModelUrl(file),
          path,
          sha256: whisperModel.sha256[file],
          onProgress: (progress) => {
            onProgress?.({
              label: 'Whisper transcription model',
              file,
              ...progress,
            });
          },
        });
      }
      return {
        modelHost: `${storage.info.origin}/${storage.info.token}/file/models/`,
        modelId: whisperModel.modelId,
        revision: whisperModel.revision,
      };
    },
  };
};
