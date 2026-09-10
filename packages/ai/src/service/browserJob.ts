import { type UnitServing } from './browserUnitServing.js';

export type BrowserJobContext = {
  reportLoading: () => void;
  serveUnits: (serving: UnitServing) => Promise<void>;
};

export type BrowserJobApi = (
  request: unknown,
  context: BrowserJobContext,
) => Promise<unknown>;

export type BrowserJobApis = Record<string, BrowserJobApi | undefined>;

export const createBrowserJobApi = <Request>(
  handler: (request: Request, context: BrowserJobContext) => Promise<unknown>,
): BrowserJobApi =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  handler as BrowserJobApi;
