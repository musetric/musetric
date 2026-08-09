import { initDatabase } from '@musetric/backend-db/migrations';
import { envs } from '../src/common/envs.js';

const report = initDatabase(envs.databasePath);

console.log(
  `Database schema v${String(report.fromVersion)} -> v${String(report.toVersion)}`,
);
