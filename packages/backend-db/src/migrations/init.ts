import { runMigrations } from './runner.js';
import { migrations } from './steps/index.js';
import { type MigrationReport } from './types.js';

export const initDatabase = (databasePath: string): MigrationReport =>
  runMigrations(databasePath, migrations);
