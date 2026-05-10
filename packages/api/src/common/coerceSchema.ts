import z from 'zod';

const unwrap = (schema: z.core.$ZodType): z.core.$ZodType => {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return unwrap(schema.def.innerType);
  }
  return schema;
};

const coerceValues = {
  number: (value: unknown) => {
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  },
  boolean: (value: unknown) => {
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      if (lowerValue === 'true' || lowerValue === 'false') {
        return lowerValue === 'true';
      }
    }
    return value;
  },
  object: (value: unknown) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed) {
          return parsed;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    return value;
  },
};

const coerceValue = (value: unknown, rawSchema: z.ZodType) => {
  const schema = unwrap(rawSchema);

  if (schema instanceof z.ZodNumber) {
    return coerceValues.number(value);
  }
  if (schema instanceof z.ZodBoolean) {
    return coerceValues.boolean(value);
  }
  if (schema instanceof z.ZodObject) {
    return coerceValues.object(value);
  }
  return value;
};

export const coerceSchema = <T>(schema: T): T => {
  if (!(schema instanceof z.ZodObject)) {
    return schema;
  }
  const { shape } = schema.def;

  const result = z.preprocess((object) => {
    if (typeof object !== 'object' || !object) {
      return object;
    }
    const init: Record<string, unknown> = {};
    return Object.entries(object).reduce((coerced, entry) => {
      const [key, value] = entry;
      coerced[key] = coerceValue(value, shape[key]);
      return coerced;
    }, init);
  }, schema);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return result as T;
};
