import { statSync } from 'node:fs';
import { type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { getBrowserBundleDir } from './gpuHostRegistry.node.js';
import { sendFile } from './httpFile.node.js';

const contentTypes: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

export const browserLoaderHtml =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
  '<script type="module" src="/index.js"></script>' +
  '</body></html>';

export const serveBundleAsset = async (
  pathname: string,
  response: ServerResponse,
): Promise<boolean> => {
  const bundleDir = getBrowserBundleDir();
  const filePath = normalize(join(bundleDir, pathname));
  if (!filePath.startsWith(normalize(bundleDir))) {
    return false;
  }
  const stat = statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    return false;
  }
  const contentType =
    contentTypes[extname(filePath)] ?? 'application/octet-stream';
  await sendFile(filePath, response, contentType);
  return true;
};
