import { invoke } from '@tauri-apps/api/core';

const encodePath = (path: string): string =>
  path
    .split('/')
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join('/');

const readLines = async (
  response: Response,
  onLine: (line: string) => void,
): Promise<void> => {
  if (!response.body) {
    throw new Error('Storage download returned an empty body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    buffered += decoder.decode(read.value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    lines.filter((line) => line.length > 0).forEach(onLine);
  }
  if (buffered.length > 0) {
    onLine(buffered);
  }
};

type DownloadLine = {
  kind: string;
  downloaded: number;
  total: number;
  cached: boolean;
  message: string;
};

const parseDownloadLine = (line: string): DownloadLine => {
  const [kind, ...rest] = line.split(' ');
  return {
    kind,
    downloaded: Number(rest[0]),
    total: Number(rest[1]),
    cached: rest[2] === 'cached',
    message: rest.join(' '),
  };
};

export type StorageDirectoryEntry = {
  name: string;
  size: number;
  directory: boolean;
};

const isDirectoryEntry = (value: unknown): value is StorageDirectoryEntry => {
  if (typeof value !== 'object' || !value) {
    return false;
  }
  const directory: unknown = Reflect.get(value, 'directory');
  const name: unknown = Reflect.get(value, 'name');
  const size: unknown = Reflect.get(value, 'size');
  return (
    typeof directory === 'boolean' &&
    typeof name === 'string' &&
    typeof size === 'number'
  );
};

export type StorageInfo = {
  origin: string;
  token: string;
  rootPath: string;
  blobsPath: string;
  modelsPath: string;
  databasePath: string;
};

export type DownloadProgress = {
  downloaded: number;
  total: number;
  cached: boolean;
};

export type DownloadFileOptions = {
  url: string;
  path: string;
  sha256: string;
  onProgress?: (progress: DownloadProgress) => void;
};

export type StorageClient = {
  info: StorageInfo;
  fileUrl: (path: string) => string;
  readFile: (path: string) => Promise<Uint8Array | undefined>;
  writeFile: (path: string, data: BufferSource) => Promise<void>;
  appendFile: (path: string, data: BufferSource) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  listDirectory: (path: string) => Promise<StorageDirectoryEntry[]>;
  downloadFile: (options: DownloadFileOptions) => Promise<number>;
};

export const createStorageClient = async (): Promise<StorageClient> => {
  const info = await invoke<StorageInfo>('storage_info');
  const base = `${info.origin}/${info.token}`;
  const fileUrl = (path: string): string => `${base}/file/${encodePath(path)}`;

  const request = async (
    method: string,
    path: string,
    body?: BufferSource,
  ): Promise<Response> => {
    const response = await fetch(fileUrl(path), { method, body });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Storage ${method} ${path} failed: HTTP ${response.status}`,
      );
    }
    return response;
  };

  return {
    info,
    fileUrl,
    readFile: async (path) => {
      const response = await request('GET', path);
      if (response.status === 404) {
        return undefined;
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    writeFile: async (path, data) => {
      await request('PUT', path, data);
    },
    appendFile: async (path, data) => {
      const response = await fetch(`${fileUrl(path)}?append=1`, {
        method: 'PUT',
        body: data,
      });
      if (!response.ok) {
        throw new Error(`Storage append ${path} failed: ${response.status}`);
      }
    },
    deleteFile: async (path) => {
      await request('DELETE', path);
    },
    listDirectory: async (path) => {
      const response = await fetch(`${base}/list/${encodePath(path)}`);
      if (!response.ok) {
        throw new Error(`Storage list ${path} failed: HTTP ${response.status}`);
      }
      const value: unknown = await response.json();
      if (!Array.isArray(value) || !value.every(isDirectoryEntry)) {
        throw new Error(`Storage list ${path} returned an invalid response`);
      }
      return value;
    },
    downloadFile: async (options) => {
      const { url, path, sha256, onProgress } = options;
      const response = await fetch(`${base}/download`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: [url, path, sha256].join('\n'),
      });
      if (!response.ok) {
        throw new Error(`Storage download failed: HTTP ${response.status}`);
      }
      const outcome: { size?: number; failure?: string } = {};
      await readLines(response, (line) => {
        const parsed = parseDownloadLine(line);
        if (parsed.kind === 'progress') {
          onProgress?.(parsed);
        }
        if (parsed.kind === 'done') {
          outcome.size = parsed.downloaded;
          onProgress?.({
            downloaded: parsed.downloaded,
            total: parsed.downloaded,
            cached: parsed.cached,
          });
        }
        if (parsed.kind === 'failed') {
          outcome.failure = parsed.message;
        }
      });
      if (outcome.failure !== undefined) {
        throw new Error(`Failed to download ${path}: ${outcome.failure}`);
      }
      if (outcome.size === undefined) {
        throw new Error(`Download of ${path} ended without a result`);
      }
      return outcome.size;
    },
  };
};
