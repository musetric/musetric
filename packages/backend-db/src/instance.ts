import { existsSync } from 'node:fs';
import {
  closeDatabase,
  openDatabase,
  readDatabase,
  readSchemaVersion,
} from './common/index.js';
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
import { migrations } from './migrations/steps/index.js';

const assertSchemaVersion = (databasePath: string): void => {
  if (!existsSync(databasePath)) {
    throw new Error(
      `there is no database at ${databasePath}; run the migrations to create it`,
    );
  }
  const version = readDatabase(databasePath, readSchemaVersion);
  if (version === migrations.length) {
    return;
  }
  throw new Error(
    `database schema v${String(version)} does not match the expected v${String(migrations.length)}; run the migrations before opening the database`,
  );
};

export const createInstance = async (databasePath: string) => {
  assertSchemaVersion(databasePath);
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
