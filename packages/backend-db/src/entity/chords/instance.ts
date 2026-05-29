import type { DatabaseSync } from 'node:sqlite';
import { getByProject } from './getByProject.js';

export const createInstance = (database: DatabaseSync) => ({
  getByProject: getByProject(database),
});
