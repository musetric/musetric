import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  openDatabase,
  readDatabase,
  withDatabase,
} from '../../common/index.js';
import { runMigrations } from '../../migrations/runner.js';
import { migrations } from '../../migrations/steps/index.js';
import {
  createWorkspace,
  getFailure,
  readJournalMode,
  readUserVersion,
  withSteps,
  type Workspace,
  writeGarbageFile,
} from './common.js';
import { buildFingerprint, readFingerprint } from './fingerprint.js';

const secondStep = ['ALTER TABLE Project ADD COLUMN note TEXT'];

const failingSecondStep = [
  'ALTER TABLE Project ADD COLUMN note TEXT',
  'ALTER TABLE Missing ADD COLUMN note TEXT',
];

const failingThirdStep = [
  'ALTER TABLE Project ADD COLUMN laterNote TEXT',
  'ALTER TABLE Missing ADD COLUMN note TEXT',
];

const danglingStep = [
  `INSERT INTO AudioMaster (projectId, type, blobId) VALUES (404, 'lead', 'orphan')`,
];

const listBackups = (databasePath: string): string[] => {
  const directory = join(dirname(databasePath), 'backups');
  return existsSync(directory) ? readdirSync(directory) : [];
};

const readProjectColumns = (databasePath: string): string[] =>
  readDatabase(databasePath, (database) =>
    database
      .prepare('PRAGMA table_info(Project)')
      .all()
      .map((row) => String(row.name)),
  );

describe('runMigrations', () => {
  let workspace: Workspace = createWorkspace();

  beforeEach(() => {
    workspace = createWorkspace();
  });

  afterEach(() => {
    workspace.remove();
  });

  it('creates a fresh database with the expected physical schema', () => {
    const report = runMigrations(workspace.databasePath, migrations);

    expect(report.fromVersion).toBe(0);
    expect(report.toVersion).toBe(migrations.length);
    expect(report.backupPath).toBeUndefined();
    expect(readUserVersion(workspace.databasePath)).toBe(migrations.length);
    expect(readJournalMode(workspace.databasePath)).toBe('wal');
    expect(listBackups(workspace.databasePath)).toEqual([]);

    const fingerprint = withDatabase(
      openDatabase(workspace.databasePath, { foreignKeys: true }),
      readFingerprint,
    );
    expect(fingerprint).toEqual(buildFingerprint(migrations));
  });

  it('does nothing on a database that is already up to date', () => {
    runMigrations(workspace.databasePath, migrations);
    const report = runMigrations(workspace.databasePath, migrations);

    expect(report.fromVersion).toBe(migrations.length);
    expect(report.toVersion).toBe(migrations.length);
    expect(listBackups(workspace.databasePath)).toEqual([]);
  });

  it('refuses a database newer than the catalog without touching it', () => {
    runMigrations(workspace.databasePath, withSteps([secondStep]));

    const failure = getFailure(() => {
      runMigrations(workspace.databasePath, migrations);
    });

    expect(failure.backupPath).toBeUndefined();
    expect(readUserVersion(workspace.databasePath)).toBe(2);
    expect(listBackups(workspace.databasePath)).toEqual([]);
  });

  it('reports a damaged file without attempting a backup', () => {
    writeGarbageFile(workspace.databasePath);

    const failure = getFailure(() => {
      runMigrations(workspace.databasePath, migrations);
    });

    expect(failure.backupPath).toBeUndefined();
    expect(failure.committedVersion).toBeUndefined();
  });

  it('rolls a failing step back and keeps the previous version', () => {
    runMigrations(workspace.databasePath, migrations);

    const failure = getFailure(() => {
      runMigrations(workspace.databasePath, withSteps([failingSecondStep]));
    });

    expect(failure.committedVersion).toBe(1);
    expect(readUserVersion(workspace.databasePath)).toBe(1);
    expect(readProjectColumns(workspace.databasePath)).not.toContain('note');
    expect(existsSync(String(failure.backupPath))).toBe(true);
  });

  it('keeps a committed earlier step when a later step fails', () => {
    runMigrations(workspace.databasePath, migrations);

    const failure = getFailure(() => {
      runMigrations(
        workspace.databasePath,
        withSteps([secondStep, failingThirdStep]),
      );
    });

    expect(failure.committedVersion).toBe(2);
    expect(readUserVersion(workspace.databasePath)).toBe(2);

    const columns = readProjectColumns(workspace.databasePath);
    expect(columns).toContain('note');
    expect(columns).not.toContain('laterNote');
  });

  it('leaves a restored backup in WAL mode once it is opened again', () => {
    runMigrations(workspace.databasePath, migrations);
    const report = runMigrations(
      workspace.databasePath,
      withSteps([secondStep]),
    );
    const backupPath = String(report.backupPath);

    expect(readJournalMode(backupPath)).toBe('delete');

    copyFileSync(backupPath, workspace.databasePath);
    closeDatabase(openDatabase(workspace.databasePath, { foreignKeys: true }));

    expect(readJournalMode(workspace.databasePath)).toBe('wal');
  });

  it('rejects a step that leaves a dangling foreign key', () => {
    runMigrations(workspace.databasePath, migrations);

    getFailure(() => {
      runMigrations(workspace.databasePath, withSteps([danglingStep]));
    });

    expect(readUserVersion(workspace.databasePath)).toBe(1);

    const orphan = readDatabase(workspace.databasePath, (database) =>
      database
        .prepare(`SELECT id FROM AudioMaster WHERE blobId = 'orphan'`)
        .get(),
    );
    expect(orphan).toBeUndefined();
  });
});
