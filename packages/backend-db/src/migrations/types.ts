export type Migration = readonly string[];

export type MigrationReport = {
  fromVersion: number;
  toVersion: number;
  backupPath?: string;
};
