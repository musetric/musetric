import type { DatabaseSync } from 'node:sqlite';

// Do not attempt to migrate or preserve old tables/data.
// Project is still early in development.

const createProject = `
  CREATE TABLE IF NOT EXISTS Project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sampleRate INTEGER NOT NULL,
    frameCount INTEGER NOT NULL
  );
`;

const createAudioAsset = `
  CREATE TABLE IF NOT EXISTS AudioAsset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createAudioWavePeaks = `
  CREATE TABLE IF NOT EXISTS AudioWavePeaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audioAssetId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (audioAssetId) REFERENCES AudioAsset(id) ON DELETE CASCADE
  );
`;

const createAudioMaster = `
  CREATE TABLE IF NOT EXISTS AudioMaster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('source', 'lead', 'backing', 'instrumental')),
    audioAssetId INTEGER NOT NULL UNIQUE,
    UNIQUE(projectId, type),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (audioAssetId) REFERENCES AudioAsset(id) ON DELETE CASCADE
  );
`;

const createAudioMasterIndex = `
  CREATE INDEX IF NOT EXISTS AudioMaster_projectId_type_index ON AudioMaster (projectId, type);
`;

const createAudioDelivery = `
  CREATE TABLE IF NOT EXISTS AudioDelivery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    stemType TEXT NOT NULL CHECK (stemType IN ('lead', 'backing', 'instrumental')),
    audioAssetId INTEGER NOT NULL UNIQUE,
    UNIQUE(projectId, stemType),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (audioAssetId) REFERENCES AudioAsset(id) ON DELETE CASCADE
  );
`;

const createAudioDeliveryIndex = `
  CREATE INDEX IF NOT EXISTS AudioDelivery_projectId_stemType_index ON AudioDelivery (projectId, stemType);
`;

const createPreview = `
  CREATE TABLE IF NOT EXISTS Preview (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    contentType TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createSubtitle = `
  CREATE TABLE IF NOT EXISTS Subtitle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createRecording = `
  CREATE TABLE IF NOT EXISTS Recording (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    audioAssetId INTEGER NOT NULL UNIQUE,
    sampleRate INTEGER NOT NULL,
    frameCount INTEGER NOT NULL,
    UNIQUE(projectId),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (audioAssetId) REFERENCES AudioAsset(id) ON DELETE CASCADE
  );
`;

const creationStatements = [
  createProject,
  createAudioAsset,
  createAudioWavePeaks,
  createAudioMaster,
  createAudioMasterIndex,
  createAudioDelivery,
  createAudioDeliveryIndex,
  createPreview,
  createSubtitle,
  createRecording,
] as const;

export const createTables = async (database: DatabaseSync): Promise<void> => {
  for (const statement of creationStatements) {
    await Promise.resolve(database.exec(statement));
  }
};
