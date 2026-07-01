/* eslint-disable @typescript-eslint/no-empty-object-type */
import {
  getLocationSearchParams,
  type NativeParams,
} from '../common/common.js';
import { createRoute, type Route } from './route.js';

export type SearchRouteOptions<Params extends object> = {
  parseNativeParams?: (nativeParams: NativeParams) => Params;
  toeNativeParams?: (params: Params) => NativeParams;
};

export type SearchRoute<Params extends object> = Route<Params, NativeParams>;

export const createSearchRoute = <Params extends object = {}>(
  options?: SearchRouteOptions<Params>,
): SearchRoute<Params> => {
  return createRoute({
    locationNativeParams: getLocationSearchParams,
    urlByNativeParams: (params) => new URLSearchParams(params).toString(),
    toNativeParams: () => ({}),
    ...options,
  });
};
