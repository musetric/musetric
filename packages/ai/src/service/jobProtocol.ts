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

export type ExecutorLogLevel = 'error' | 'warn';

export type ExecutorMessage =
  | { type: 'ready'; adapter: boolean; shaderF16: boolean }
  | { type: 'pong' }
  | { type: 'log'; level: ExecutorLogLevel; message: string }
  | { type: 'loading'; jobId: string; loaded: number; total: number }
  | { type: 'building'; jobId: string }
  | { type: 'loaded'; jobId: string }
  | {
      type: 'running';
      jobId: string;
      pass: 'decode' | 'repair';
      unit: number;
      unitCount: number;
    }
  | { type: 'result'; jobId: string; result?: unknown }
  | { type: 'failed'; jobId: string; error: string }
  | { type: 'unitOpened'; jobId: string; attemptId: string }
  | { type: 'unitDone'; jobId: string; attemptId: string; unit: number };
