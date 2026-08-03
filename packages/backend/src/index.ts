import { createServerApp } from '@musetric/backend-core';
import { type AppConfig } from '@musetric/backend-core/config';
import { killDevHost } from './common/dev.js';
import { envs } from './common/envs.js';
import { getHttps } from './services/https.js';

const startServer = async () => {
  const config: AppConfig = {
    version: envs.version,
    logLevel: envs.logLevel,
    blobsPath: envs.blobsPath,
    publicPath: envs.publicPath,
    databasePath: envs.databasePath,
    modelsPath: envs.modelsPath,
    browserBundlePath: envs.browserBundlePath,
    https: await getHttps(),
  };
  const app = await createServerApp(config);
  try {
    await app.listen({
      port: envs.port,
      host: envs.host,
      listenTextResolver: (rawAddress) => {
        const address = rawAddress.replace('127.0.0.1', 'localhost');
        return `Server: ${address}\tSwagger: ${address}/docs`;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('EADDRINUSE')) {
      console.error(`Port ${envs.port} is already in use`);
      killDevHost();
      process.exit(1);
    }
    throw error;
  }
};

await startServer();
