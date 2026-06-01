import { type DatabaseSync } from 'node:sqlite';
import { create } from './create.js';
import { get } from './get.js';
import { list } from './list.js';
import { remove } from './remove.js';
import { update } from './update.js';

export const createInstance = (database: DatabaseSync) => ({
  list: list(database),
  get: get(database),
  create: create(database),
  update: update(database),
  remove: remove(database),
});
