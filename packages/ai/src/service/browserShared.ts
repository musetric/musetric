import {
  type BrowserPhaseMessage,
  type BrowserRunningUnits,
  reportPhaseApiName,
} from './browserApi.js';

const reportPhase = async (message: BrowserPhaseMessage): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportPhaseApiName);
  if (typeof api !== 'function') {
    throw new Error('AI phase API is not initialized');
  }
  await Reflect.apply(api, undefined, [message]);
};

export const reportLoading = async (): Promise<void> =>
  reportPhase({ type: 'loading' });

export const reportRunning = async (
  units: BrowserRunningUnits,
): Promise<void> => reportPhase({ type: 'running', ...units });

export const fetchOk = async (
  url: string,
  label: string,
): Promise<Response> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }
  return response;
};

export const fetchFloat32 = async (
  url: string,
  label: string,
): Promise<Float32Array<ArrayBuffer>> => {
  const response = await fetchOk(url, label);
  return new Float32Array(await response.arrayBuffer());
};

export const registerBrowserApi = <Request, Result>(
  apiName: string,
  handler: (request: Request) => Promise<Result>,
): void => {
  Reflect.set(globalThis, apiName, handler);
};
