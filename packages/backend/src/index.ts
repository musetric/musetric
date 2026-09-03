import { defaultOpenJobPage } from '@musetric/ai/node';
import { ffmpegPath, ffprobePath } from '@musetric/ffmpeg';
import {
  isAddressInUseError,
  type RustProxy,
  startRustProxy,
} from '@musetric/server';
import { killDevHost } from './common/dev.js';
import { envs } from './common/envs.js';
import { getHttps } from './services/https.js';

const createDisplayUrl = (url: string): string =>
  url.replace(/\/\/(0\.0\.0\.0|127\.0\.0\.1):/u, '//localhost:');

const start = async (): Promise<RustProxy> => {
  const https = await getHttps();
  return await startRustProxy({
    listen: `${envs.host}:${String(envs.port)}`,
    databasePath: envs.databasePath,
    blobsPath: envs.blobsPath,
    ffmpegPath: ffmpegPath(),
    ffprobePath: ffprobePath(),
    modelsPath: envs.modelsPath,
    browserBundlePath: envs.browserBundlePath,
    publicPath: envs.publicPath,
    openPage: defaultOpenJobPage,
    tls: https,
    onLog: (line) => {
      console.log(line);
    },
  });
};

const reportStartFailure = (error: unknown): never => {
  if (isAddressInUseError(error)) {
    console.error(`Port ${String(envs.port)} is already in use`);
    killDevHost();
    process.exit(1);
  }
  throw error;
};

const startServer = async (): Promise<void> => {
  const server = await start().catch(reportStartFailure);
  const { fromVersion, toVersion } = server.migration;
  console.log(
    `Database schema v${String(fromVersion)} -> v${String(toVersion)}`,
  );
  console.log(`Server: ${createDisplayUrl(server.url)}`);

  const stop = (): void => {
    void server.close().then(() => {
      process.exit();
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
};

await startServer();
