import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { type Logger } from '../logger.js';
import {
  createMessageHandler,
  type MessageHandlers,
} from '../messageHandler.js';
import { createTextProcessor, tryParseMessage } from './common.node.js';

export type StdoutBinary = {
  mode: 'binary';
  onChunk: (chunk: Buffer) => void;
};

export type StdoutText = {
  mode: 'text';
  onLine: (line: string) => void;
};

export type StdoutJson<Message extends { type: string }> = {
  mode: 'json';
  handlers: MessageHandlers<Message>;
};

export type StdoutOptions<Message extends { type: string }> =
  | StdoutBinary
  | StdoutText
  | StdoutJson<Message>;

const defaultStdout: StdoutOptions<never> = {
  mode: 'binary',
  onChunk: () => {
    /* ignore */
  },
};

export type AttachStdoutOptions<Message extends { type: string }> = {
  childProcess: ChildProcessWithoutNullStreams;
  stdout?: StdoutOptions<Message>;
  logger: Logger;
  processName: string;
};

export type AttachStdoutResult<Message extends { type: string }> = {
  getResult: () => Extract<Message, { type: 'result' }> | undefined;
};

export const attachStdout = <Message extends { type: string }>(
  options: AttachStdoutOptions<Message>,
): AttachStdoutResult<Message> => {
  const { childProcess, stdout = defaultStdout, logger, processName } = options;

  type Result = Extract<Message, { type: 'result' }>;
  let result: Result | undefined = undefined;

  if (stdout.mode === 'binary') {
    const { onChunk } = stdout;
    childProcess.stdout.on('data', onChunk);
  }

  if (stdout.mode === 'text') {
    const { onLine } = stdout;
    childProcess.stdout.on(
      'data',
      createTextProcessor(logger, processName, onLine),
    );
  }

  if (stdout.mode === 'json') {
    const handle = createMessageHandler<Message>({
      ...stdout.handlers,
      result: (message: Result) => {
        result = message;
      },
    });
    childProcess.stdout.on(
      'data',
      createTextProcessor(logger, processName, async (line) => {
        const message = tryParseMessage<Message>(line);
        if (message === undefined) {
          logger.error(
            { processName, line },
            'Child script cannot parse message',
          );
          return;
        }

        try {
          const ok = await handle(message);
          if (!ok) {
            logger.error(
              { processName, line },
              'Child script received unknown message',
            );
          }
        } catch (error) {
          logger.error({ processName, error }, 'Child script handler error');
        }
      }),
    );
  }

  return {
    getResult: () => result,
  };
};
