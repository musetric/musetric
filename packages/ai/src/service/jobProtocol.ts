export const jobUrlParameter = 'jobs';
export const deliverFileApiName = 'musetricAiDeliverFile';
export const jobSocketPath = '/jobs';
export const uploadRoute = '/uploads/';

const asObject = (value: unknown): object | undefined =>
  typeof value === 'object' && value ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

const asBoolean = (value: unknown): boolean =>
  typeof value === 'boolean' && value;

const parse = (text: string): object | undefined => {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return undefined;
  }
};

export type ExecutorReady = {
  type: 'ready';
  adapter: boolean;
  shaderF16: boolean;
};

const readReady = (message: object): ExecutorReady => ({
  type: 'ready',
  adapter: asBoolean(Reflect.get(message, 'adapter')),
  shaderF16: asBoolean(Reflect.get(message, 'shaderF16')),
});

export type ExecutorProgress = {
  type: 'progress';
  jobId: string;
  progress: number;
};

const readProgress = (
  message: object,
  jobId: string,
): ExecutorProgress | undefined => {
  const progress = asNumber(Reflect.get(message, 'progress'));
  return progress === undefined
    ? undefined
    : { type: 'progress', jobId, progress };
};

export type ExecutorFailure = {
  type: 'failed';
  jobId: string;
  error: string;
};

const readFailure = (
  message: object,
  jobId: string,
): ExecutorFailure | undefined => {
  const error = asString(Reflect.get(message, 'error'));
  return error === undefined ? undefined : { type: 'failed', jobId, error };
};

export type ExecutorResult = {
  type: 'result';
  jobId: string;
  result: unknown;
};

export type ExecutorJobMessage =
  | ExecutorProgress
  | ExecutorResult
  | ExecutorFailure;

export type ExecutorMessage = ExecutorReady | ExecutorJobMessage;

export const readExecutorMessage = (
  text: string,
): ExecutorMessage | undefined => {
  const message = parse(text);
  if (!message) {
    return undefined;
  }
  const kind = asString(Reflect.get(message, 'type'));
  if (kind === 'ready') {
    return readReady(message);
  }
  const jobId = asString(Reflect.get(message, 'jobId'));
  if (jobId === undefined) {
    return undefined;
  }
  if (kind === 'progress') {
    return readProgress(message, jobId);
  }
  if (kind === 'result') {
    return { type: 'result', jobId, result: Reflect.get(message, 'result') };
  }
  if (kind === 'failed') {
    return readFailure(message, jobId);
  }
  return undefined;
};

export type JobCommand = {
  type: 'job';
  jobId: string;
  api: string;
  uploadUrl: string;
  request: unknown;
};

export const readJobCommand = (text: string): JobCommand | undefined => {
  const message = parse(text);
  if (!message || asString(Reflect.get(message, 'type')) !== 'job') {
    return undefined;
  }
  const jobId = asString(Reflect.get(message, 'jobId'));
  const api = asString(Reflect.get(message, 'api'));
  const uploadUrl = asString(Reflect.get(message, 'uploadUrl'));
  if (jobId === undefined || api === undefined || uploadUrl === undefined) {
    return undefined;
  }
  return {
    type: 'job',
    jobId,
    api,
    uploadUrl,
    request: Reflect.get(message, 'request'),
  };
};
