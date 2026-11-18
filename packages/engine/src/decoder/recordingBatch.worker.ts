import { type LiveTakeChunk } from '../player/protocol.cross.js';
import { type ProjectRealtime } from './realtime.worker.js';
import { createRecordingPacket } from './recordingStream.worker.js';

const packetSeconds = 0.05;

const continues = (last: LiveTakeChunk, chunk: LiveTakeChunk): boolean =>
  chunk.startFrame === last.startFrame &&
  chunk.offset === last.offset + last.samples.length;

export type RecordingBatchOptions = {
  sampleRate: number;
  realtime: Pick<ProjectRealtime, 'sendBinary'>;
};

export type RecordingBatch = {
  push: (chunk: LiveTakeChunk) => void;
  flush: () => void;
};

export const createRecordingBatch = (
  options: RecordingBatchOptions,
): RecordingBatch => {
  const { sampleRate, realtime } = options;
  const frameCount = Math.round(sampleRate * packetSeconds);
  let pending: LiveTakeChunk[] = [];
  let pendingFrames = 0;

  const flush = () => {
    if (pending.length === 0) {
      return;
    }
    const samples = new Float32Array(pendingFrames);
    let at = 0;
    for (const chunk of pending) {
      samples.set(chunk.samples, at);
      at += chunk.samples.length;
    }
    const [{ startFrame, offset }] = pending;
    pending = [];
    pendingFrames = 0;
    realtime.sendBinary(createRecordingPacket({ startFrame, offset, samples }));
  };

  return {
    push: (chunk) => {
      const last = pending.at(-1);
      if (last && !continues(last, chunk)) {
        flush();
      }
      pending.push(chunk);
      pendingFrames += chunk.samples.length;
      if (pendingFrames >= frameCount) {
        flush();
      }
    },
    flush,
  };
};
