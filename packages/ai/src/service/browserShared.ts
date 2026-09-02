import {
  type BrowserProgressMessage,
  reportProgressApiName,
} from './browserApi.js';
import { deliverFileApiName } from './jobProtocol.js';

type AnchorElement = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};
declare const document: {
  createElement: (tagName: 'a') => AnchorElement;
  body: { appendChild: (node: AnchorElement) => void };
};

export const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  const message: BrowserProgressMessage = { type: 'progress', progress };
  await Reflect.apply(api, undefined, [message]);
};

const downloadFile = async (
  name: string,
  bytes: ArrayBuffer,
): Promise<void> => {
  const blob = new Blob([bytes], {
    type: 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  await new Promise((resolve) => setTimeout(resolve, 250));
  URL.revokeObjectURL(url);
};

export const deliverFile = async (
  name: string,
  bytes: ArrayBuffer,
): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, deliverFileApiName);
  if (typeof api !== 'function') {
    await downloadFile(name, bytes);
    return;
  }
  await Reflect.apply(api, undefined, [name, bytes]);
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
