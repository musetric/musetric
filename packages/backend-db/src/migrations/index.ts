import { type DatabaseSync } from 'node:sqlite';

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

const createAudioMaster = `
  CREATE TABLE IF NOT EXISTS AudioMaster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('source', 'lead', 'backing', 'instrumental')),
    blobId TEXT NOT NULL UNIQUE,
    UNIQUE(projectId, type),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createAudioMasterIndex = `
  CREATE INDEX IF NOT EXISTS AudioMaster_projectId_type_index ON AudioMaster (projectId, type);
`;

const createProjectAudioAnalysis = `
  CREATE TABLE IF NOT EXISTS ProjectAudioAnalysis (
    projectId INTEGER PRIMARY KEY,
    sourceIntegratedLoudnessDb REAL NOT NULL,
    sourceTruePeakDb REAL NOT NULL,
    sourceGainDb REAL NOT NULL,
    leadIntegratedLoudnessDb REAL NOT NULL,
    leadTruePeakDb REAL NOT NULL,
    leadP95RmsDb REAL NOT NULL,
    leadSpectrogramGainDb REAL NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createAudioDelivery = `
  CREATE TABLE IF NOT EXISTS AudioDelivery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    stemType TEXT NOT NULL CHECK (stemType IN ('lead', 'backing', 'instrumental')),
    blobId TEXT NOT NULL UNIQUE,
    waveBlobId TEXT NOT NULL UNIQUE,
    UNIQUE(projectId, stemType),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
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

const createRhythm = `
  CREATE TABLE IF NOT EXISTS Rhythm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createKey = `
  CREATE TABLE IF NOT EXISTS Key (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createChords = `
  CREATE TABLE IF NOT EXISTS Chords (
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
    blobId TEXT NOT NULL UNIQUE,
    waveBlobId TEXT NOT NULL UNIQUE,
    sampleRate INTEGER NOT NULL,
    frameCount INTEGER NOT NULL,
    UNIQUE(projectId),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const creationStatements = [
  createProject,
  createAudioMaster,
  createAudioMasterIndex,
  createProjectAudioAnalysis,
  createAudioDelivery,
  createAudioDeliveryIndex,
  createPreview,
  createSubtitle,
  createRhythm,
  createKey,
  createChords,
  createRecording,
] as const;

export const createTables = async (database: DatabaseSync): Promise<void> => {
  for (const statement of creationStatements) {
    await Promise.resolve(database.exec(statement));
  }
};
