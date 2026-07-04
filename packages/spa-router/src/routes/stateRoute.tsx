/* eslint-disable @typescript-eslint/no-empty-object-type */
import { createRoute, type Route } from './route.js';

export type StateRouteOptions<Params extends object> = {
  parseNativeParams?: (nativeParams: unknown) => Params;
  toNativeParams?: (params: Params) => unknown;
};
export type StateRoute<Params extends object> = Route<Params, unknown>;

export const createStateRoute = <Params extends object = {}>(
  options?: StateRouteOptions<Params>,
): StateRoute<Params> =>
  createRoute({
    locationNativeParams: () => window.history.state,
    ...options,
  });
