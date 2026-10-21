import { z } from 'zod';

const base64Alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64Values = new Map(
  [...base64Alphabet].map((symbol, index) => [symbol, index]),
);

export const decodeSamples = (text: string): Float32Array => {
  const padding = (text.at(-1) === '=' ? 1 : 0) + (text.at(-2) === '=' ? 1 : 0);
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let byte = 0;
  for (let index = 0; index < text.length; index += 4) {
    const chunk =
      ((base64Values.get(text[index]) ?? 0) << 18) |
      ((base64Values.get(text[index + 1]) ?? 0) << 12) |
      ((base64Values.get(text[index + 2]) ?? 0) << 6) |
      (base64Values.get(text[index + 3]) ?? 0);
    for (let shift = 16; shift >= 0 && byte < bytes.length; shift -= 8) {
      bytes[byte] = (chunk >> shift) & 0xff;
      byte += 1;
    }
  }
  return new Float32Array(bytes.buffer);
};

const samplesSchema = z.string().transform(decodeSamples);

const latencySchema = z.object({
  sampleRate: z.number(),
  latencySource: z.string(),
  latencyDevicePairKey: z.string().optional(),
  reportedOutputFrameCount: z.number(),
  outputFrameCount: z.number(),
  recordingFrameCount: z.number(),
  timedRoundTripFrameCount: z.number().optional(),
  inputLabel: z.string().optional(),
  outputLabel: z.string().optional(),
  outputKind: z.string(),
});

export type PageLatency = z.infer<typeof latencySchema>;

export const calibrationSchema = z.object({
  calibrated: z.boolean(),
  error: z.string().optional(),
  latency: latencySchema,
});

export const timingRunSchema = z.object({
  sampleRate: z.number(),
  tempo: z.number(),
  startFrame: z.number(),
  beatFrames: z.array(z.number()),
  playhead: z.array(z.tuple([z.number(), z.number(), z.number()])),
  captured: z.object({
    sampleRate: z.number(),
    samples: samplesSchema,
    chunks: z.array(z.tuple([z.number(), z.number()])),
  }),
  take: z.object({ firstFrame: z.number(), samples: samplesSchema }),
  latency: latencySchema,
  latencyDuring: latencySchema.optional(),
});

export type TimingRun = z.infer<typeof timingRunSchema>;

export const delayRunSchema = z.object({
  sampleRate: z.number(),
  view: z.enum(['notes', 'spectrum']),
  startedAt: z.number(),
  stoppedAt: z.number(),
  arrivals: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
  latency: latencySchema,
  latencyDuring: latencySchema.optional(),
});

export type DelayRun = z.infer<typeof delayRunSchema>;

export const browserCaptureSchema = z.object({
  sampleRate: z.number(),
  label: z.string(),
  settings: z.record(z.string(), z.unknown()),
  samples: samplesSchema,
});

export const soundTakeSchema = z.object({
  sampleRate: z.number(),
  firstFrame: z.number(),
  samples: samplesSchema,
  latency: latencySchema,
});

const edgeValuesSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export type EdgeLog = {
  startedAt: number;
  playheadFrame: number;
  renderedAt: number;
  pitchEdge: number;
  energyEdge: number;
  writtenEnd: number;
  level: number;
};

export const parseEdgeLog = (rawValues: readonly unknown[]): EdgeLog => {
  const [
    startedAt,
    playheadFrame,
    renderedAt,
    pitchEdge,
    energyEdge,
    writtenEnd,
    level,
  ] = edgeValuesSchema.parse(rawValues);
  return {
    startedAt,
    playheadFrame,
    renderedAt,
    pitchEdge,
    energyEdge,
    writtenEnd,
    level,
  };
};
