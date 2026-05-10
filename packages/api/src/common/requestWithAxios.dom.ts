/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { type AxiosInstance } from 'axios';
import type z from 'zod';
import { apiMultipart } from './apiMultipart.dom.js';
import { type ApiRoute, type RequestMethod } from './apiRoute.js';
import { getArrayBufferViewConstructor } from './arrayBufferView.js';

type AxiosParams<ParamsSchema> = ParamsSchema extends z.ZodVoid
  ? {}
  : { params: z.infer<ParamsSchema> };

type AxiosRequest<RequestSchema> = RequestSchema extends z.ZodVoid
  ? {}
  : { data: z.infer<RequestSchema> };

export type RequestWithAxiosOptions<ParamsSchema, RequestSchema> =
  AxiosParams<ParamsSchema> & AxiosRequest<RequestSchema>;

export const requestWithAxios = async <
  Method extends RequestMethod,
  Path extends string,
  ParamsSchema,
  RequestSchema,
  ResponseSchema,
>(
  axios: AxiosInstance,
  route: ApiRoute<Method, Path, ParamsSchema, RequestSchema, ResponseSchema>,
  options: RequestWithAxiosOptions<ParamsSchema, RequestSchema>,
) => {
  const arrayConstructor = getArrayBufferViewConstructor(route.responseSchema);
  const { params } = options as { params: z.infer<ParamsSchema> };
  const { data } = options as { data: z.infer<RequestSchema> };
  const requestData = route.isMultipart
    ? apiMultipart.data(data as object)
    : data;

  const response = await axios.request<z.infer<ResponseSchema>>({
    method: route.method,
    url: route.endpoint(params),
    data: requestData,
    responseType: arrayConstructor ? 'arraybuffer' : 'json',
  });

  if (arrayConstructor) {
    const arrayBuffer = response.data as ArrayBuffer;
    const result = new arrayConstructor(arrayBuffer);
    return result;
  }
  return response.data;
};
