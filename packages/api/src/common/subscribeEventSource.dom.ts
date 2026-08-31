import { type z } from 'zod';
import { type ApiEvent, type UnsubscribeApiEvent } from './apiEvent.js';

const stripTrailingSlashes = (value: string): string => {
  let endIndex = value.length;
  while (endIndex > 0 && value[endIndex - 1] === '/') {
    endIndex -= 1;
  }
  return value.slice(0, endIndex);
};

const getApiEventSourcePath = (path: string): string => {
  const baseUrl: unknown = Reflect.get(globalThis, 'musetricApiBaseUrl');
  if (typeof baseUrl !== 'string') {
    return path;
  }
  return `${stripTrailingSlashes(baseUrl)}${path}`;
};

export const subscribeEventSource = <
  Path extends string,
  EventSchema extends z.ZodType,
>(
  apiEvent: ApiEvent<Path, EventSchema>,
  callback: (event: z.infer<EventSchema>) => void,
): UnsubscribeApiEvent => {
  const source = new EventSource(getApiEventSourcePath(apiEvent.path));

  source.onmessage = (event) => {
    const parsedEvent = JSON.parse(event.data);
    const validatedEvent = apiEvent.schema.parse(parsedEvent);
    callback(validatedEvent);
  };

  source.onerror = (error) => {
    console.error('API Event SSE error', error);
  };

  return () => {
    source.close();
  };
};
