import { type Logger } from '../logger.js';

export const tryParseMessage = <Message>(line: string): Message | undefined => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

export const createTextProcessor = (
  logger: Logger,
  processName: string,
  onLine: (line: string) => void,
) => {
  let text = '';

  return (data: Buffer) => {
    text += data.toString();

    while (text.includes('\n')) {
      const newlineIndex = text.indexOf('\n');
      const chunk = text.substring(0, newlineIndex);
      const line = chunk.trim();
      text = text.substring(newlineIndex + 1);

      if (line) {
        try {
          onLine(line);
        } catch (error) {
          logger.error(
            {
              processName,
              error,
              line,
            },
            'Text processor handler error',
          );
        }
      }
    }
  };
};
