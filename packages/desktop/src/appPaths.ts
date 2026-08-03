import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

const createDataRootPath = (): string => {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'linux') {
    return process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  }
  return app.getPath('appData');
};

const createDataDirectoryName = (): string =>
  app.isPackaged ? app.getName() : `${app.getName()} Dev`;

export const applyAppPaths = (): void => {
  app.setPath(
    'userData',
    join(createDataRootPath(), createDataDirectoryName()),
  );
};
