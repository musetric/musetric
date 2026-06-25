import { spawn } from 'node:child_process';
import { type Logger, type LogLevel } from '../logger.js';
import { SpawnScriptError } from './error.node.js';
import { attachStderr, type StderrOptions } from './spawnStderr.node.js';
import { attachStdout, type StdoutOptions } from './spawnStdout.node.js';

export type LogInfo = {
  level: LogLevel;
  message: string;
};

export type SpawnScriptOptions<Message extends { type: string }> = {
  command: string;
  args?: Record<string, string>;
  flatArgs?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: StdoutOptions<Message>;
  stderr?: StderrOptions;
  cwd?: string;
  logger: Logger;
  processName: string;
};

export const spawnScript = async <Message extends { type: string }>(
  options: SpawnScriptOptions<Message>,
) => {
  type Result = Extract<Message, { type: 'result' }>;
  return new Promise<Result | undefined>((resolve, reject) => {
    const { command, args, cwd, logger, processName } = options;
    const spawnArgs = [
      ...Object.entries(args ?? {}).flat(),
      ...(options.flatArgs ?? []),
    ];

    const childProcess = spawn(command, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...options.env },
    });

    const { getResult } = attachStdout({
      childProcess,
      stdout: options.stdout,
      logger,
      processName,
    });

    const { getLastInfo } = attachStderr({
      childProcess,
      stderr: options.stderr,
      logger,
      processName,
    });

    childProcess.on('close', (code) => {
      try {
        const lastInfo = getLastInfo();
        if (code !== 0) {
          throw new SpawnScriptError(
            lastInfo?.message ?? `Child script failed with code ${code}`,
            code ?? undefined,
          );
        }
        const result = getResult();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    childProcess.on('error', (error) => {
      logger.error({ processName, error }, 'Child script process error');
      reject(error);
    });
  });
};
