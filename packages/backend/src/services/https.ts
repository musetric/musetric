import { type ServerOptions } from 'node:https';
import { generate } from 'selfsigned';
import { envs } from '../common/envs.js';

export const getHttps = async (): Promise<ServerOptions | null> => {
  if (envs.protocol !== 'https') {
    // eslint-disable-next-line musetric/no-null-literal
    return null;
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
