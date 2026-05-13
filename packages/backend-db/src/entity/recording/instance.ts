import type { DatabaseSync } from 'node:sqlite';
import { create } from './create.js';
import { get } from './get.js';

export const createInstance = (database: DatabaseSync) => ({
  create: create(database),
  get: get(database),
});
