import { dirname } from 'node:path';
import { readMigrationFailure } from '@musetric/backend-db/migrations';
import { dialog } from 'electron';
import { type DesktopLog, reportFatal } from './logging.js';

const describeBackup = (backupPath: string): string[] => [
  `A copy of the database from before the update is in ${backupPath}`,
  `To restore it, close Musetric, delete app.db, app.db-wal and app.db-shm in ${dirname(dirname(backupPath))}, then copy the backup there under the name app.db.`,
];

export const reportStartupFailure = (log: DesktopLog, error: unknown): void => {
  const migration = readMigrationFailure(error);
  if (!migration) {
    reportFatal(log, 'the app failed to start', error);
    return;
  }
  log.logger.fatal({ error, ...migration }, 'the database migration failed');
  const lines = [
    error instanceof Error ? error.message : String(error),
    ...(migration.backupPath === undefined
      ? []
      : describeBackup(migration.backupPath)),
    `The details are in ${log.path}`,
  ];
  dialog.showErrorBox(
    'Musetric could not update its database',
    lines.join('\n\n'),
  );
};
