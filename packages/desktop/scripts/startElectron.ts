import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const packageRequire = createRequire(import.meta.url);
const electronCliPath = packageRequire.resolve('electron/cli.js');
const nodeOptions = (globalThis.process.env.NODE_OPTIONS ?? '')
  .split(' ')
  .filter((option) => option !== '--conditions=monorepo')
  .join(' ');
const env = { ...globalThis.process.env };
Reflect.set(env, 'NODE_OPTIONS', nodeOptions);
Reflect.deleteProperty(env, 'ELECTRON_RUN_AS_NODE');

const electron = spawn(globalThis.process.execPath, [electronCliPath, '.'], {
  stdio: 'inherit',
  env,
});

electron.once('exit', (code) => {
  globalThis.process.exitCode = code ?? 1;
});
