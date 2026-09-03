const migrationPrefix = 'MUSETRIC_MIGRATION=';
const migrationFailedPrefix = 'MUSETRIC_MIGRATION_FAILED=';

export type MigrationFailure = {
  message: string;
  committedVersion?: number;
  backupPath?: string;
};

const migrationFailures = new WeakMap<Error, MigrationFailure>();

export const readMigrationFailure = (
  error: unknown,
): MigrationFailure | undefined =>
  error instanceof Error ? migrationFailures.get(error) : undefined;

const readLine = <Reported>(text: string): Reported | undefined => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export type MigrationReport = {
  fromVersion: number;
  toVersion: number;
  backupPath?: string;
};

export type MigrationReader = {
  handleLine: (line: string) => boolean;
  report: () => MigrationReport | undefined;
  fail: (error: Error) => Error;
};

export const createMigrationReader = (): MigrationReader => {
  let report: MigrationReport | undefined = undefined;
  let failure: MigrationFailure | undefined = undefined;
  return {
    handleLine: (line) => {
      if (line.startsWith(migrationPrefix)) {
        report = readLine(line.slice(migrationPrefix.length));
        return true;
      }
      if (line.startsWith(migrationFailedPrefix)) {
        failure = readLine(line.slice(migrationFailedPrefix.length));
        return true;
      }
      return false;
    },
    report: () => report,
    fail: (error) => {
      if (failure === undefined) {
        return error;
      }
      const reported = new Error(failure.message, { cause: error });
      migrationFailures.set(reported, failure);
      return reported;
    },
  };
};
