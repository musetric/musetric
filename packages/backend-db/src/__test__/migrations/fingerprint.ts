import { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../../common/index.js';
import { type Migration } from '../../migrations/types.js';

const schemaQuery = `
  SELECT type, name, sql FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`;

const normalize = (value: unknown): string =>
  String(value).replaceAll(/\s+/gu, ' ').trim();

export const readFingerprint = (database: DatabaseSync): string[] =>
  database
    .prepare(schemaQuery)
    .all()
    .map(
      (row) =>
        `${normalize(row.type)} ${normalize(row.name)} ${normalize(row.sql)}`,
    );

export const buildFingerprint = (steps: readonly Migration[]): string[] =>
  withDatabase(new DatabaseSync(':memory:'), (database) => {
    for (const statements of steps) {
      for (const statement of statements) {
        database.exec(statement);
      }
    }
    return readFingerprint(database);
  });
