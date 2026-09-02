import { expect, test } from 'vitest';
import { captureEverything } from './apiCaptures.js';
import { withTestServer } from './apiResponse.js';

test('the answers do not depend on how the request arrives', async () => {
  const injected = await withTestServer(captureEverything, 'inject');
  const overHttp = await withTestServer(captureEverything, 'http');
  const throughProxy = await withTestServer(captureEverything, 'proxy');

  expect(overHttp).toEqual(injected);
  expect(throughProxy).toEqual(injected);
}, 300_000);
