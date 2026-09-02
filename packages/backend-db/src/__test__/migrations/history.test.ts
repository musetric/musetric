import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrations } from '../../migrations/steps/index.js';
import { buildFingerprint } from './fingerprint.js';

const releasedMigrationDigests = new Map([
  [1, 'e71f8336c7109a247e55369587943d45a4ebfe9bef8170a536ef504e306346f8'],
]);

const fingerprintPath = new URL(
  '../../../schema.fingerprint.json',
  import.meta.url,
);
const expectedFingerprint: unknown = JSON.parse(
  readFileSync(fingerprintPath, 'utf8'),
);

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
