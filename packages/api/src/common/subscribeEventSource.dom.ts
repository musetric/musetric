import { type z } from 'zod';
import { type ApiEvent, type UnsubscribeApiEvent } from './apiEvent.js';

export const subscribeEventSource = <
  Path extends string,
  EventSchema extends z.ZodType,
>(
  apiEvent: ApiEvent<Path, EventSchema>,
  callback: (event: z.infer<EventSchema>) => void,
): UnsubscribeApiEvent => {
  const source = new EventSource(apiEvent.path);

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
