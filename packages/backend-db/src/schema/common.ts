import { z } from 'zod';

export const numericIdSchema = z
  .union([z.number(), z.bigint()])
  .transform((value) => {
    const result = typeof value === 'bigint' ? Number(value) : value;
    if (!Number.isSafeInteger(result)) {
      throw new Error('Expected id to be a safe integer');
    }
    return result;
  });
