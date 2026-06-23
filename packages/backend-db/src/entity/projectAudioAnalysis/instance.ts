import { type DatabaseSync } from 'node:sqlite';
import { get } from './get.js';
import { upsert } from './upsert.js';

export const createInstance = (database: DatabaseSync) => ({
  get: get(database),
  upsert: upsert(database),
});
