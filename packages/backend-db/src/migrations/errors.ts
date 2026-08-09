export type MigrationFailure = {
  committedVersion?: number;
  backupPath?: string;
};

const failures = new WeakMap<Error, MigrationFailure>();

export const readMigrationFailure = (
  error: unknown,
): MigrationFailure | undefined =>
  error instanceof Error ? failures.get(error) : undefined;

export type MigrationFailureOptions = MigrationFailure & {
  message: string;
  cause?: unknown;
};

export const createMigrationFailure = (
  options: MigrationFailureOptions,
): Error => {
  const { message, cause, ...failure } = options;
  const error = new Error(message, { cause });
  failures.set(error, failure);
  return error;
};
