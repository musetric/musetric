import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';

export const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  const message: BrowserProgressMessage = { type: 'progress', progress };
  await Reflect.apply(api, undefined, [message]);
};

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
