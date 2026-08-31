import axios from 'axios';
import { createMobileProcessingQueue } from './processing/index.js';
import { createStorageClient } from './storage/index.js';

const waitForPaint = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
};

const dismissNativeSplash = (): void => {
  const bridge = Reflect.get(globalThis, 'MusetricStartup');
  if (typeof bridge !== 'object' || !bridge) {
    return;
  }
  const ready = Reflect.get(bridge, 'ready');
  if (typeof ready === 'function') {
    Reflect.apply(ready, bridge, []);
  }
};

const isProcessingRenderer = (): boolean => {
  const bridge = Reflect.get(globalThis, 'MusetricExecution');
  if (typeof bridge !== 'object' || !bridge) {
    return true;
  }
  const selectExecutor = Reflect.get(bridge, 'separationExecutor');
  if (typeof selectExecutor !== 'function') {
    return true;
  }
  return Reflect.apply(selectExecutor, bridge, []) !== 'standby';
};

const requestMobileProcessingRetry = (): void => {
  const bridge = Reflect.get(globalThis, 'MusetricExecution');
  if (typeof bridge !== 'object' || !bridge) {
    return;
  }
  const retry = Reflect.get(bridge, 'retryProcessing');
  if (typeof retry === 'function') {
    Reflect.apply(retry, bridge, []);
  }
};

const storage = await createStorageClient();
const apiBaseUrl = `${storage.info.origin}/${storage.info.token}`;

axios.defaults.baseURL = apiBaseUrl;
Reflect.set(globalThis, 'musetricApiBaseUrl', apiBaseUrl);
Reflect.set(globalThis, 'musetricEngineBackendUrl', apiBaseUrl);
Reflect.set(globalThis, 'musetricRetryProcessing', requestMobileProcessingRetry);
if (isProcessingRenderer()) {
  createMobileProcessingQueue(storage).start();
}

await import('@musetric/frontend');
await waitForPaint();
dismissNativeSplash();
