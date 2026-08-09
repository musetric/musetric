import { closeDatabase, openDatabase } from './common/index.js';
import {
  audioDelivery,
  audioMaster,
  blob,
  chords,
  key,
  preview,
  processing,
  project,
  projectAudioAnalysis,
  recording,
  rhythm,
  subtitle,
  wavePeaks,
} from './entity/index.js';

export const createInstance = async (databasePath: string) => {
  const database = await Promise.resolve(
    openDatabase(databasePath, { foreignKeys: true }),
  );

  return {
    project: project.createInstance(database),
    projectAudioAnalysis: projectAudioAnalysis.createInstance(database),
    preview: preview.createInstance(database),
    audioMaster: audioMaster.createInstance(database),
    audioDelivery: audioDelivery.createInstance(database),
    wavePeaks: wavePeaks.createInstance(database),
    recording: recording.createInstance(database),
    processing: processing.createInstance(database),
    subtitle: subtitle.createInstance(database),
    rhythm: rhythm.createInstance(database),
    key: key.createInstance(database),
    chords: chords.createInstance(database),
    blob: blob.createInstance(database),
    disconnect: async () => {
      await Promise.resolve(closeDatabase(database));
    },
  };
};
export type Instance = Awaited<ReturnType<typeof createInstance>>;
