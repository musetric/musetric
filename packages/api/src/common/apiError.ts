import axios, { type AxiosError } from 'axios';
import { z } from 'zod';

export namespace apiError {
  export const responseSchema = z.object({
    message: z.string(),
  });
  export type Response = z.infer<typeof responseSchema>;
  export const isResponse = (value: unknown): value is AxiosError<Response> =>
    axios.isAxiosError(value) &&
    responseSchema.safeParse(value.response?.data).success;
  export const getMessage = (value: unknown) =>
    isResponse(value) ? value.response?.data.message : undefined;
}
