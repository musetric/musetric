import { createServerApp } from '@musetric/backend-core';
import { type AppConfig } from '@musetric/backend-core/config';
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

const startServer = async () => {
  const https = await getHttps();
  const config: AppConfig = {
    version: envs.version,
    logLevel: envs.logLevel,
    blobsPath: envs.blobsPath,
    publicPath: envs.publicPath,
    databasePath: envs.databasePath,
    modelsPath: envs.modelsPath,
    browserBundlePath: envs.browserBundlePath,
  };
  const app = await createServerApp(config);
  let proxy: RustProxy | undefined = undefined;
  try {
    await app.listen({
      port: 0,
      host: '127.0.0.1',
    });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('backend failed to bind a local HTTP port');
    }
    proxy = await startRustProxy({
      upstream: `http://127.0.0.1:${String(address.port)}`,
      listen: `${envs.host}:${String(envs.port)}`,
      databasePath: config.databasePath,
      blobsPath: config.blobsPath,
      ffmpegPath: ffmpegPath(),
      ffprobePath: ffprobePath(),
      modelsPath: config.modelsPath,
      browserBundlePath: config.browserBundlePath,
      publicPath: config.publicPath,
      tls: https,
      onLog: (line) => {
        console.log(line);
      },
    });
    const shown = createDisplayUrl(proxy.url);
    console.log(`Server: ${shown}\tSwagger: ${shown}/docs`);
  } catch (error) {
    await proxy?.close();
    await app.close();
    if (isAddressInUseError(error)) {
      console.error(`Port ${envs.port} is already in use`);
      killDevHost();
      process.exit(1);
    }
    throw error;
  }

  const close = async (): Promise<void> => {
    await proxy.close();
    await app.close();
  };
  const stop = (): void => {
    void close().then(() => {
      process.exit();
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
};

await startServer();
