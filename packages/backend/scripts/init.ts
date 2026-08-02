import { initDatabase } from '@musetric/backend-db/migrations';
import { envs } from '../src/common/envs.js';

await initDatabase(envs.databasePath);
console.log('Database schema initialized');
