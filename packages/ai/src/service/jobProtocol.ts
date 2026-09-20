import { z } from 'zod/mini';

export const jobSocketPath = '/jobs';

const jobId = z.string();
const attemptId = z.string();

const pingCommandSchema = z.object({ type: z.literal('ping') });

const reloadCommandSchema = z.object({ type: z.literal('reload') });

const jobCommandSchema = z.object({
  type: z.literal('job'),
  jobId,
  api: z.string(),
  request: z.unknown(),
});

const unitCommandSchema = z.object({
  type: z.literal('unit'),
  jobId,
  attemptId,
  unit: z.number(),
  unitCount: z.number(),
});

const unitCloseCommandSchema = z.object({
  type: z.literal('unitClose'),
  jobId,
  attemptId,
});

const hostCommandSchema = z.discriminatedUnion('type', [
  pingCommandSchema,
  reloadCommandSchema,
  jobCommandSchema,
  unitCommandSchema,
  unitCloseCommandSchema,
]);

export type JobCommand = z.infer<typeof jobCommandSchema>;
export type UnitCommand = z.infer<typeof unitCommandSchema>;
export type UnitCloseCommand = z.infer<typeof unitCloseCommandSchema>;
export type UnitEvent = UnitCommand | UnitCloseCommand;
export type HostCommand = z.infer<typeof hostCommandSchema>;

export const readHostCommand = (text: string): HostCommand =>
  hostCommandSchema.parse(JSON.parse(text));

const readySchema = z.object({
  type: z.literal('ready'),
  adapter: z.boolean(),
  shaderF16: z.boolean(),
});

const aliveSchema = z.object({ type: z.literal('pong') });

const logLevelSchema = z.enum(['error', 'warn']);

const logSchema = z.object({
  type: z.literal('log'),
  level: logLevelSchema,
  message: z.string(),
});

const loadingSchema = z.object({ type: z.literal('loading'), jobId });

const runningSchema = z.object({
  type: z.literal('running'),
  jobId,
  pass: z.enum(['decode', 'repair']),
  unit: z.number(),
  unitCount: z.number(),
});

const resultSchema = z.object({
  type: z.literal('result'),
  jobId,
  result: z.optional(z.unknown()),
});

const failureSchema = z.object({
  type: z.literal('failed'),
  jobId,
  error: z.string(),
});

const unitOpenedSchema = z.object({
  type: z.literal('unitOpened'),
  jobId,
  attemptId,
});

const unitDoneSchema = z.object({
  type: z.literal('unitDone'),
  jobId,
  attemptId,
  unit: z.number(),
});

const executorMessageSchema = z.discriminatedUnion('type', [
  readySchema,
  aliveSchema,
  logSchema,
  loadingSchema,
  runningSchema,
  resultSchema,
  failureSchema,
  unitOpenedSchema,
  unitDoneSchema,
]);

export type ExecutorReady = z.infer<typeof readySchema>;
export type ExecutorLogLevel = z.infer<typeof logLevelSchema>;
export type ExecutorJobMessage =
  | z.infer<typeof loadingSchema>
  | z.infer<typeof runningSchema>
  | z.infer<typeof resultSchema>
  | z.infer<typeof failureSchema>
  | z.infer<typeof unitOpenedSchema>
  | z.infer<typeof unitDoneSchema>;
export type ExecutorMessage = z.infer<typeof executorMessageSchema>;

export const readExecutorMessage = (text: string): ExecutorMessage =>
  executorMessageSchema.parse(JSON.parse(text));
