import { type DatabaseSync } from 'node:sqlite';
import { list } from './list.js';

export const createInstance = (database: DatabaseSync) => ({
  list: list(database),
});
