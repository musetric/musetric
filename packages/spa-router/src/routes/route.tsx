/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { onChangeLocation, useMemoLocation } from '../common/locationEvent.js';
import { createLink, type LinkFC } from '../components/Link.js';
import { createMatch, type MatchFC } from '../components/Match.js';

const readCurrentUrl = () => {
  const { pathname, hash, search } = window.location;
  return `${pathname}${hash}${search}`;
};

const isPreviousEntry = (url: string) => {
  const { state }: { state: unknown } = window.history;
  return (
    typeof state === 'object' &&
    Boolean(state) &&
    (state as { previous?: unknown }).previous === url
  );
};

export type RouteOptions<Params extends object, NativeParams> = {
  locationNativeParams?: () => NativeParams;
  parseNativeParams?: (nativeParams: NativeParams) => Params;
  toNativeParams?: (params: Params) => NativeParams;
  urlByNativeParams?: (params: NativeParams) => string;
  prefixName?: string;
};

export type Route<Params extends object, NativeParams> = {
  locationNativeParams: () => NativeParams;
  parseNativeParams: (nativeParams: NativeParams) => Params;
  toNativeParams: (params: Params) => NativeParams;
  urlByNativeParams: (params: NativeParams) => string;
  href: (params: Params) => string;
  navigate: keyof Params extends never
    ? (params?: Params) => void
    : (params: Params) => void;
  replace: keyof Params extends never
    ? (params?: Params) => void
    : (params: Params) => void;
  Link: LinkFC<Params>;
  assertMatch: () => Params;
  match: () => Params | undefined;
  useAssertMatch: () => Params;
  useMatch: () => Params | undefined;
  Match: MatchFC<Params>;
};

export const createRoute = <Params extends object, NativeParams>(
  options: RouteOptions<Params, NativeParams>,
): Route<Params, NativeParams> => {
  const {
    locationNativeParams = () => ({}) as NativeParams,
    parseNativeParams = (nativeParams) => nativeParams as unknown as Params,
    toNativeParams = (params) => params as unknown as NativeParams,
    urlByNativeParams = () => '',
    prefixName,
  } = options;

  const href = (params: Params) => {
    const nativeParams = toNativeParams(params);
    return urlByNativeParams(nativeParams);
  };
  const navigate = (params: Params = {} as Params) => {
    const nativeParams = toNativeParams(params);
    const url = urlByNativeParams(nativeParams);
    if (isPreviousEntry(url)) {
      history.back();
      return;
    }
    history.pushState({ previous: readCurrentUrl() }, '', url);
    onChangeLocation();
  };
  const replace = (params: Params = {} as Params) => {
    const nativeParams = toNativeParams(params);
    history.replaceState(history.state, '', urlByNativeParams(nativeParams));
    onChangeLocation();
  };
  const Link = createLink(href, navigate, prefixName);
  const assertMatch = (): Params => {
    const nativeParams = locationNativeParams();
    return parseNativeParams(nativeParams);
  };
  const match = () => {
    try {
      return assertMatch();
    } catch {
      return undefined;
    }
  };
  const useAssertMatch = () => useMemoLocation(assertMatch);
  const useMatch = () => useMemoLocation(match);
  const Match = createMatch(match, prefixName);

  return {
    locationNativeParams,
    parseNativeParams,
    toNativeParams,
    urlByNativeParams,
    href,
    navigate,
    replace,
    Link,
    assertMatch,
    match,
    useAssertMatch,
    useMatch,
    Match,
  };
};
