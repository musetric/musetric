import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrations } from '../../migrations/steps/index.js';
import { buildFingerprint } from './fingerprint.js';

const releasedMigrationDigests = new Map([
  [1, 'd4f8df3472b50b1c4e51c9adbeb52532c514807a10b28d02ae3195d3bf67d9d6'],
]);

const expectedFingerprint = [
  'index AudioDelivery_projectId_stemType_index CREATE INDEX AudioDelivery_projectId_stemType_index ON AudioDelivery (projectId, stemType)',
  'index AudioMaster_projectId_type_index CREATE INDEX AudioMaster_projectId_type_index ON AudioMaster (projectId, type)',
  "table AudioDelivery CREATE TABLE AudioDelivery ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL, stemType TEXT NOT NULL CHECK (stemType IN ('lead', 'backing', 'instrumental')), blobId TEXT NOT NULL UNIQUE, waveBlobId TEXT NOT NULL UNIQUE, UNIQUE(projectId, stemType), FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )",
  "table AudioMaster CREATE TABLE AudioMaster ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL, type TEXT NOT NULL CHECK (type IN ('source', 'lead', 'backing', 'instrumental')), blobId TEXT NOT NULL UNIQUE, UNIQUE(projectId, type), FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )",
  'table Chords CREATE TABLE Chords ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL UNIQUE, blobId TEXT NOT NULL UNIQUE, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
  'table Key CREATE TABLE Key ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL UNIQUE, blobId TEXT NOT NULL UNIQUE, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
  'table Preview CREATE TABLE Preview ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL UNIQUE, blobId TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, contentType TEXT NOT NULL, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
  'table Project CREATE TABLE Project ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sampleRate INTEGER NOT NULL, frameCount INTEGER NOT NULL )',
  'table ProjectAudioAnalysis CREATE TABLE ProjectAudioAnalysis ( projectId INTEGER PRIMARY KEY, sourceIntegratedLoudnessDb REAL NOT NULL, sourceTruePeakDb REAL NOT NULL, sourceGainDb REAL NOT NULL, leadIntegratedLoudnessDb REAL NOT NULL, leadTruePeakDb REAL NOT NULL, leadP95RmsDb REAL NOT NULL, leadSpectrogramGainDb REAL NOT NULL, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
  'table Recording CREATE TABLE Recording ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL, blobId TEXT NOT NULL UNIQUE, waveBlobId TEXT NOT NULL UNIQUE, sampleRate INTEGER NOT NULL, frameCount INTEGER NOT NULL, UNIQUE(projectId), FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
  'table Rhythm CREATE TABLE Rhythm ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL UNIQUE, blobId TEXT NOT NULL UNIQUE, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
  'table Subtitle CREATE TABLE Subtitle ( id INTEGER PRIMARY KEY AUTOINCREMENT, projectId INTEGER NOT NULL UNIQUE, blobId TEXT NOT NULL UNIQUE, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE )',
];

const readMigrationDigest = (statements: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify(statements)).digest('hex');

describe('released migration history', () => {
  it('matches the committed digest of every released step', () => {
    const actual = migrations
      .map((statements, index) => [index + 1, readMigrationDigest(statements)])
      .filter((entry) => releasedMigrationDigests.has(Number(entry[0])));
    expect(actual).toEqual([...releasedMigrationDigests]);
  });

  it('matches the committed physical schema snapshot', () => {
    expect(buildFingerprint(migrations)).toEqual(expectedFingerprint);
  });
});
