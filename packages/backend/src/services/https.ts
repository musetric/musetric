import { type ServerOptions } from 'node:https';
import { generate } from 'selfsigned';
import { envs } from '../common/envs.js';

export const getHttps = async (): Promise<ServerOptions | undefined> => {
  if (envs.protocol !== 'https') {
    return undefined;
  }
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    extensions: [{ name: 'basicConstraints', cA: true }],
  });
  return {
    key: pems.private,
    cert: pems.cert,
  };
};
