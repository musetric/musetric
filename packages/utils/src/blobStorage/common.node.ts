import fs from 'fs/promises';
import path from 'path';

export const getBlobPath = (rootPath: string, blobId: string) => {
  const level1 = blobId.substring(0, 2);
  const level2 = blobId.substring(2, 4);
  return path.join(rootPath, level1, level2, blobId);
};

const getSubDirectoryPaths = async (
  directoryPath: string,
): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directoryPath, entry.name));
};

const isDirectoryExists = async (dirPath: string): Promise<boolean> => {
  const stat = await fs.stat(dirPath).catch(() => undefined);
  return stat?.isDirectory() ?? false;
};

const getDirectoryBlobIds = async (
  directoryPath: string,
): Promise<string[]> => {
  const fileEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  return fileEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
};

export const getDirectoryShardPaths = async (
  rootPath: string,
): Promise<string[]> => {
  const directoryExists = await isDirectoryExists(rootPath);
  if (!directoryExists) {
    return [];
  }
  const level1 = await getSubDirectoryPaths(rootPath);
  const level2 = await Promise.all(level1.map(getSubDirectoryPaths));
  return level2.flat();
};

export const getDirectoriesBlobIds = async (
  directories: string[],
): Promise<string[]> => {
  const blobIdsArray = await Promise.all(directories.map(getDirectoryBlobIds));

  return blobIdsArray.flat();
};
