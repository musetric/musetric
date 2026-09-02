import { generate } from 'selfsigned';
import { envs } from '../common/envs.js';

export type HttpsCredentials = {
  certificate: string;
  privateKey: string;
};

export const getHttps = async (): Promise<HttpsCredentials | undefined> => {
  if (envs.protocol !== 'https') {
    return undefined;
  }
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    extensions: [{ name: 'basicConstraints', cA: true }],
  });
  return { certificate: pems.cert, privateKey: pems.private };
};
