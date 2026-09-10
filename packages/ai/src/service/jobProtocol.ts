export const jobUrlParameter = 'jobs';
export const jobSocketPath = '/jobs';

const asObject = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || !value) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

const asBoolean = (value: unknown): boolean =>
  typeof value === 'boolean' && value;

const parse = (text: string): Record<string, unknown> | undefined => {
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

const readReady = (message: Record<string, unknown>): ExecutorReady => ({
  type: 'ready',
  adapter: asBoolean(message['adapter']),
  shaderF16: asBoolean(message['shaderF16']),
});

export type ExecutorRunning = {
  type: 'running';
  jobId: string;
  pass: 'decode' | 'repair';
  unit: number;
  unitCount: number;
};

const readPass = (value: unknown): ExecutorRunning['pass'] | undefined => {
  const pass = asString(value);
  return pass === 'decode' || pass === 'repair' ? pass : undefined;
};

const readRunning = (
  message: Record<string, unknown>,
  jobId: string,
): ExecutorRunning | undefined => {
  const pass = readPass(message['pass']);
  const unit = asNumber(message['unit']);
  const unitCount = asNumber(message['unitCount']);
  if (pass === undefined || unit === undefined || unitCount === undefined) {
    return undefined;
  }
  return { type: 'running', jobId, pass, unit, unitCount };
};

export type ExecutorFailure = {
  type: 'failed';
  jobId: string;
  error: string;
};

const readFailure = (
  message: Record<string, unknown>,
  jobId: string,
): ExecutorFailure | undefined => {
  const error = asString(message['error']);
  return error === undefined ? undefined : { type: 'failed', jobId, error };
};

const readAttemptId = (message: Record<string, unknown>): string | undefined =>
  asString(message['attemptId']);

export type ExecutorUnitOpened = {
  type: 'unitOpened';
  jobId: string;
  attemptId: string;
};

const readUnitOpened = (
  message: Record<string, unknown>,
  jobId: string,
): ExecutorUnitOpened | undefined => {
  const attemptId = readAttemptId(message);
  return attemptId === undefined
    ? undefined
    : { type: 'unitOpened', jobId, attemptId };
};

export type ExecutorUnitDone = {
  type: 'unitDone';
  jobId: string;
  attemptId: string;
  unit: number;
};

const readUnitDone = (
  message: Record<string, unknown>,
  jobId: string,
): ExecutorUnitDone | undefined => {
  const attemptId = readAttemptId(message);
  const unit = asNumber(message['unit']);
  if (attemptId === undefined || unit === undefined) {
    return undefined;
  }
  return { type: 'unitDone', jobId, attemptId, unit };
};

export type ExecutorResult = {
  type: 'result';
  jobId: string;
  result: unknown;
};

export type ExecutorLoading = {
  type: 'loading';
  jobId: string;
};

export type ExecutorJobMessage =
  | ExecutorLoading
  | ExecutorRunning
  | ExecutorResult
  | ExecutorFailure
  | ExecutorUnitOpened
  | ExecutorUnitDone;

export type ExecutorMessage = ExecutorReady | ExecutorJobMessage;

export const readExecutorMessage = (
  text: string,
): ExecutorMessage | undefined => {
  const message = parse(text);
  if (!message) {
    return undefined;
  }
  const kind = asString(message['type']);
  if (kind === 'ready') {
    return readReady(message);
  }
  const jobId = asString(message['jobId']);
  if (jobId === undefined) {
    return undefined;
  }
  if (kind === 'loading') {
    return { type: 'loading', jobId };
  }
  if (kind === 'running') {
    return readRunning(message, jobId);
  }
  if (kind === 'result') {
    return { type: 'result', jobId, result: message['result'] };
  }
  if (kind === 'failed') {
    return readFailure(message, jobId);
  }
  if (kind === 'unitOpened') {
    return readUnitOpened(message, jobId);
  }
  if (kind === 'unitDone') {
    return readUnitDone(message, jobId);
  }
  return undefined;
};

export type JobCommand = {
  type: 'job';
  jobId: string;
  api: string;
  request: unknown;
};

export const readJobCommand = (text: string): JobCommand | undefined => {
  const message = parse(text);
  if (!message || asString(message['type']) !== 'job') {
    return undefined;
  }
  const jobId = asString(message['jobId']);
  const api = asString(message['api']);
  if (jobId === undefined || api === undefined) {
    return undefined;
  }
  return {
    type: 'job',
    jobId,
    api,
    request: message['request'],
  };
};

export type UnitCommand = {
  type: 'unit';
  jobId: string;
  attemptId: string;
  unit: number;
  unitCount: number;
};

export type UnitCloseCommand = {
  type: 'unitClose';
  jobId: string;
  attemptId: string;
};

export type UnitEvent = UnitCommand | UnitCloseCommand;

export const readUnitEvent = (text: string): UnitEvent | undefined => {
  const message = parse(text);
  if (!message) {
    return undefined;
  }
  const kind = asString(message['type']);
  const jobId = asString(message['jobId']);
  const attemptId = readAttemptId(message);
  if (jobId === undefined || attemptId === undefined) {
    return undefined;
  }
  if (kind === 'unitClose') {
    return { type: 'unitClose', jobId, attemptId };
  }
  if (kind !== 'unit') {
    return undefined;
  }
  const unit = asNumber(message['unit']);
  const unitCount = asNumber(message['unitCount']);
  if (unit === undefined || unitCount === undefined) {
    return undefined;
  }
  return { type: 'unit', jobId, attemptId, unit, unitCount };
};
