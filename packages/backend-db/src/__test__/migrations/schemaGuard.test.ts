import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../../common/index.js';
import { createInstance } from '../../instance.js';
import { createWorkspace, type Workspace } from './common.js';

describe('createInstance', () => {
  let workspace: Workspace = createWorkspace();

  beforeEach(() => {
    workspace = createWorkspace();
  });

  afterEach(() => {
    workspace.remove();
  });

  it('says that the database has not been created yet', async () => {
    await expect(createInstance(workspace.databasePath)).rejects.toThrow(
      'run the migrations to create it',
    );
  });

  it('refuses a database that the migrations have not reached', async () => {
    closeDatabase(openDatabase(workspace.databasePath, { foreignKeys: true }));

    await expect(createInstance(workspace.databasePath)).rejects.toThrow(
      'does not match the expected',
    );
  });
});
