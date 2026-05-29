import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  audioDelivery,
  audioMaster,
  blob,
  chords,
  key,
  preview,
  processing,
  project,
  recording,
  rhythm,
  subtitle,
  wavePeaks,
} from './entity/index.js';

export const createDatabase = async (
  databasePath: string,
): Promise<DatabaseSync> => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  await Promise.resolve(database.exec('PRAGMA foreign_keys = ON;'));
  await Promise.resolve(database.exec('PRAGMA journal_mode = WAL;'));
  return database;
};

export const createInstance = async (databasePath: string) => {
  const database = await createDatabase(databasePath);

  return {
    project: project.createInstance(database),
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
      if (database.isOpen) {
        database.close();
      }
      await Promise.resolve();
    },
  };
};
export type Instance = Awaited<ReturnType<typeof createInstance>>;
