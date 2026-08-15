import { type Migration } from '../types.js';

const createProject = `
  CREATE TABLE Project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sampleRate INTEGER NOT NULL,
    frameCount INTEGER NOT NULL
  );
`;

const createAudioMaster = `
  CREATE TABLE AudioMaster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('source', 'lead', 'backing', 'instrumental')),
    blobId TEXT NOT NULL UNIQUE,
    UNIQUE(projectId, type),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createAudioMasterIndex = `
  CREATE INDEX AudioMaster_projectId_type_index ON AudioMaster (projectId, type);
`;

const createProjectAudioAnalysis = `
  CREATE TABLE ProjectAudioAnalysis (
    projectId INTEGER PRIMARY KEY,
    sourceIntegratedLoudnessDb REAL NOT NULL,
    sourceTruePeakDb REAL NOT NULL,
    sourceGainDb REAL NOT NULL,
    leadIntegratedLoudnessDb REAL NOT NULL,
    leadTruePeakDb REAL NOT NULL,
    leadP95RmsDb REAL NOT NULL,
    leadSpectrogramGainDb REAL NOT NULL,
    backingIntegratedLoudnessDb REAL NOT NULL,
    backingTruePeakDb REAL NOT NULL,
    instrumentalIntegratedLoudnessDb REAL NOT NULL,
    instrumentalTruePeakDb REAL NOT NULL,
    leadGainDb REAL NOT NULL,
    backingGainDb REAL NOT NULL,
    instrumentalGainDb REAL NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createAudioDelivery = `
  CREATE TABLE AudioDelivery (
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
  CREATE INDEX AudioDelivery_projectId_stemType_index ON AudioDelivery (projectId, stemType);
`;

const createPreview = `
  CREATE TABLE Preview (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    contentType TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createSubtitle = `
  CREATE TABLE Subtitle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createRhythm = `
  CREATE TABLE Rhythm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createKey = `
  CREATE TABLE Key (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createChords = `
  CREATE TABLE Chords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
`;

const createRecording = `
  CREATE TABLE Recording (
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

export const v001Initial: Migration = [
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
];
