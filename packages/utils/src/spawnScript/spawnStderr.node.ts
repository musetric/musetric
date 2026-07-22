import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isLogLevel, type Logger } from '../logger.js';
import { createTextProcessor, tryParseMessage } from './common.node.js';
import { type LogInfo } from './spawnScript.node.js';

export type StderrBinary = {
  mode: 'binary';
  onChunk: (chunk: Buffer) => void;
};

export type StderrText = {
  mode: 'text';
  onLine: (line: string) => void;
};

export type StderrLogText = {
  mode: 'logText';
};

export type StderrLogJson = {
  mode: 'logJson';
};

export type StderrOptions =
  | StderrBinary
  | StderrText
  | StderrLogText
  | StderrLogJson;

const defaultStderr: StderrOptions = {
  mode: 'binary',
  onChunk: () => undefined,
};

export type AttachStderrOptions = {
  childProcess: ChildProcessWithoutNullStreams;
  stderr?: StderrOptions;
  logger: Logger;
  processName: string;
};

export type AttachStderrResult = {
  getLastInfo: () => LogInfo | undefined;
};

export const attachStderr = (
  options: AttachStderrOptions,
): AttachStderrResult => {
  const { childProcess, stderr = defaultStderr, logger, processName } = options;
  let lastInfo: LogInfo | undefined = undefined;

  if (stderr.mode === 'binary') {
    const { onChunk } = stderr;
    childProcess.stderr.on('data', onChunk);
  }

  if (stderr.mode === 'text') {
    const { onLine } = stderr;
    childProcess.stderr.on(
      'data',
      createTextProcessor(logger, processName, onLine),
    );
  }

  if (stderr.mode === 'logText') {
    childProcess.stderr.on(
      'data',
      createTextProcessor(logger, processName, (line) => {
        logger.info({ processName }, line);
        const info: LogInfo = { level: 'info', message: line };
        lastInfo = info;
      }),
    );
  }

  if (stderr.mode === 'logJson') {
    childProcess.stderr.on(
      'data',
      createTextProcessor(logger, processName, (line) => {
        const info = tryParseMessage<LogInfo>(line);
        if (info === undefined) {
          logger.error(
            { processName, line },
            'Child script cannot parse log info',
          );
          return;
        }
        const level = isLogLevel(info.level) ? info.level : 'info';
        const log = logger[level];
        log({ processName }, info.message);
        if (level === 'error' || lastInfo?.level !== 'error') {
          lastInfo = info;
        }
      }),
    );
  }

  return {
    getLastInfo: () => lastInfo,
  };
};
