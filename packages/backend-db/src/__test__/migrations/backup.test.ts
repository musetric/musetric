import { describe, expect, it } from 'vitest';
import { createBackupName } from '../../migrations/backup.js';

const invalidWindowsCharacters = /[:*?"<>|]/u;

describe('createBackupName', () => {
  it('avoids characters that no Windows file name may hold', () => {
    const name = createBackupName(3, new Date('2026-08-08T09:14:16.123Z'));

    expect(name).toBe('app-2026-08-08T09-14-16-123Z-v3.db');
    expect(invalidWindowsCharacters.test(name)).toBe(false);
  });
});
