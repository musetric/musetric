import { type Migration } from '../types.js';
import { v001Initial } from './v001Initial.js';

export const migrations: readonly Migration[] = [v001Initial];
