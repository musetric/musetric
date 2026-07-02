import { type z } from 'zod';

export type UnsubscribeApiEvent = () => void;
export type ApiEvent<Path, EventSchema> = {
  path: Path;
  schema: EventSchema;
  stringify: (event: z.infer<EventSchema>) => string;
};

export type CreateApiEventOptions<Path, EventSchema> = {
  path: Path;
  schema: EventSchema;
};

export const createApiEvent = <
  Path extends string,
  EventSchema extends z.ZodType,
>(
  options: CreateApiEventOptions<Path, EventSchema>,
): ApiEvent<Path, EventSchema> => {
  const { path, schema } = options;

  return {
    path,
    schema,
    stringify: (event: z.infer<EventSchema>): string => {
      const validatedEvent = schema.parse(event);
      return JSON.stringify(validatedEvent);
    },
  };
};
