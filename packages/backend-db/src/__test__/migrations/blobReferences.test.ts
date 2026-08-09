import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  readDatabase,
  withDatabase,
} from '../../common/index.js';
import { createInstance } from '../../instance.js';
import { runMigrations } from '../../migrations/runner.js';
import { migrations } from '../../migrations/steps/index.js';
import { createWorkspace, type Workspace } from './common.js';

const knownBlobColumns = [
  'AudioDelivery.blobId',
  'AudioDelivery.waveBlobId',
  'AudioMaster.blobId',
  'Chords.blobId',
  'Key.blobId',
  'Preview.blobId',
  'Recording.blobId',
  'Recording.waveBlobId',
  'Rhythm.blobId',
  'Subtitle.blobId',
];

const seedStatements = [
  `INSERT INTO Project (name, sampleRate, frameCount) VALUES ('song', 44100, 100)`,
  `INSERT INTO AudioMaster (projectId, type, blobId) VALUES (1, 'source', 'AudioMaster.blobId')`,
  `INSERT INTO AudioDelivery (projectId, stemType, blobId, waveBlobId) VALUES (1, 'lead', 'AudioDelivery.blobId', 'AudioDelivery.waveBlobId')`,
  `INSERT INTO Preview (projectId, blobId, filename, contentType) VALUES (1, 'Preview.blobId', 'cover.png', 'image/png')`,
  `INSERT INTO Subtitle (projectId, blobId) VALUES (1, 'Subtitle.blobId')`,
  `INSERT INTO Rhythm (projectId, blobId) VALUES (1, 'Rhythm.blobId')`,
  `INSERT INTO Key (projectId, blobId) VALUES (1, 'Key.blobId')`,
  `INSERT INTO Chords (projectId, blobId) VALUES (1, 'Chords.blobId')`,
  `INSERT INTO Recording (projectId, blobId, waveBlobId, sampleRate, frameCount) VALUES (1, 'Recording.blobId', 'Recording.waveBlobId', 44100, 100)`,
];

const readBlobColumns = (databasePath: string): string[] =>
  readDatabase(databasePath, (database) => {
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all()
      .map((row) => String(row.name));
    return tables
      .flatMap((table) =>
        database
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => `${table}.${String(row.name)}`),
      )
      .filter((column) => column.toLowerCase().endsWith('blobid'))
      .toSorted((left, right) => left.localeCompare(right));
  });

describe('referenced blob ids', () => {
  let workspace: Workspace = createWorkspace();

  beforeEach(() => {
    workspace = createWorkspace();
    runMigrations(workspace.databasePath, migrations);
  });

  afterEach(() => {
    workspace.remove();
  });

  it('covers every blob column the schema declares', () => {
    expect(readBlobColumns(workspace.databasePath)).toEqual(knownBlobColumns);
  });

  it('lists a value stored in every blob column', async () => {
    withDatabase(
      openDatabase(workspace.databasePath, { foreignKeys: true }),
      (database) => {
        for (const statement of seedStatements) {
          database.exec(statement);
        }
      },
    );

    const instance = await createInstance(workspace.databasePath);
    const blobIds = await instance.blob.list();
    await instance.disconnect();

    expect(
      blobIds.toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(knownBlobColumns);
  });
});
