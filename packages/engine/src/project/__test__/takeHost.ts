import { vi } from 'vitest';
import { recordingStreamChannel } from '../../player/recordingStream.cross.js';
import { spectrogramDataChannel } from '../../spectrogram/protocol.cross.js';
import { engineProjectChannel } from '../protocol.cross.js';
import { createProjectWorkerRuntime } from '../runtime.worker.js';
import { stubSockets } from './fakeSocket.js';
import {
  createScriptedHost,
  readMessageType,
  type TakeRun,
} from './scriptedHost.js';

export const takeRate = 1000;
const chunkFrameCount = 16;
const reconnectWaitMs = 10_000;
const settleRounds = 100;

export const activeRecording = {
  id: 1,
  name: 'Take',
  active: true,
  canUndo: false,
  canRedo: false,
  empty: true,
  lost: false,
};

export const flushPorts = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        resolve(undefined);
      };
      port2.postMessage(undefined);
    });
  }
};

type Singer = {
  takeId: string;
  index: number;
  worklet: ReturnType<typeof recordingStreamChannel.inbound<MessagePort>>;
  sequence: number;
  runs: TakeRun[];
  nextStart: number | undefined;
};

const currentRun = (singer: Singer): TakeRun => {
  const last = singer.runs.at(-1);
  if (last && singer.nextStart === undefined) {
    return last;
  }
  const run = { startFrame: singer.nextStart ?? 0, samples: [] };
  singer.runs.push(run);
  singer.nextStart = undefined;
  return run;
};

const singChunk = (singer: Singer, frameCount: number) => {
  const run = currentRun(singer);
  const offset = run.samples.length;
  const runIndex = singer.runs.indexOf(run);
  const samples = Array.from(
    { length: frameCount },
    (_, index) => singer.index * 1_000_000 + runIndex * 10_000 + offset + index,
  );
  run.samples.push(...samples);
  singer.sequence += 1;
  singer.worklet.methods.chunk({
    sequence: singer.sequence,
    startFrame: run.startFrame,
    offset,
    samples: Float32Array.from(samples),
  });
};

export type EngineMessage = {
  type: string;
  payload?: { takeId?: string; reason?: string };
};

export type TakeHost = {
  received: EngineMessage[];
  stored: ReadonlyMap<string, TakeRun[]>;
  faults: string[];
  record: (takeId: string) => Promise<void>;
  sing: (frameCount: number) => void;
  seek: (startFrame: number) => void;
  stop: () => Promise<void>;
  finish: () => Promise<void>;
  serve: (count?: number) => void;
  answer: (count?: number) => Promise<void>;
  settle: () => Promise<void>;
  drop: (expire?: boolean) => Promise<void>;
  reconnect: () => Promise<void>;
  connected: () => boolean;
  close: () => Promise<void>;
  refuseNextStart: () => void;
  sent: () => string[];
  sung: (takeId: string) => TakeRun[];
};

export const createTakeHost = async (): Promise<TakeHost> => {
  const sockets = stubSockets();
  const control = new MessageChannel();
  const player = new MessageChannel();
  const spectrogram = new MessageChannel();
  createProjectWorkerRuntime({
    port: engineProjectChannel.inbound(control.port1),
    spectrogramPort: spectrogramDataChannel.outbound(spectrogram.port1),
  });
  const received: EngineMessage[] = [];
  control.port2.onmessage = (event: MessageEvent<EngineMessage>) => {
    received.push(event.data);
  };
  const engine = engineProjectChannel.outbound(control.port2);
  engine.methods.connectPlayer({ playerPort: player.port1 });
  engine.methods.mount({ projectId: 1, sampleRate: takeRate });
  await flushPorts();
  const [first] = sockets;
  const host = createScriptedHost(first);
  first.open();

  const sung = new Map<string, TakeRun[]>();
  let singer: Singer | undefined = undefined;

  const answer = async (count?: number) => {
    host.answer(count);
    await flushPorts();
  };

  const endSinging = () => {
    const current = singer;
    singer = undefined;
    return current;
  };

  return {
    received,
    stored: host.stored,
    faults: host.faults,
    record: async (takeId) => {
      const stream = new MessageChannel();
      const runs: TakeRun[] = [];
      sung.set(takeId, runs);
      singer = {
        takeId,
        index: sung.size,
        worklet: recordingStreamChannel.inbound(stream.port2),
        sequence: 0,
        runs,
        nextStart: 0,
      };
      engine.methods.startRecordingStream({
        takeId,
        projectId: 1,
        sampleRate: takeRate,
        frameCount: takeRate * 600,
        latencyFrameCount: 0,
        tempo: 1,
        transpose: 0,
        octave: 0,
        draft: false,
        port: stream.port1,
      });
      await flushPorts();
    },
    sing: (frameCount) => {
      for (let at = 0; singer && at < frameCount; at += chunkFrameCount) {
        singChunk(singer, Math.min(chunkFrameCount, frameCount - at));
      }
    },
    seek: (startFrame) => {
      if (singer) {
        singer.nextStart = startFrame;
      }
    },
    stop: async () => {
      const current = endSinging();
      if (!current) {
        return;
      }
      current.sequence += 1;
      current.worklet.methods.flush({ sequence: current.sequence });
      engine.methods.finishRecordingStream({
        takeId: current.takeId,
        sequence: current.sequence,
      });
      await flushPorts();
    },
    finish: async () => {
      const current = endSinging();
      if (!current) {
        return;
      }
      engine.methods.finishRecordingStream({
        takeId: current.takeId,
        sequence: 0,
      });
      await flushPorts();
    },
    serve: host.serve,
    answer,
    settle: async () => {
      for (let round = 0; round < settleRounds; round += 1) {
        host.serve();
        if (host.idle()) {
          return;
        }
        await answer();
      }
      host.faults.push('the host and the page never settled');
    },
    drop: async (expire = false) => {
      host.drop(expire);
      await flushPorts();
    },
    reconnect: async () => {
      await vi.advanceTimersByTimeAsync(reconnectWaitMs);
      const socket = sockets[sockets.length - 1];
      host.attach(socket);
      socket.open();
      await flushPorts();
    },
    connected: () => sockets[sockets.length - 1].readyState === WebSocket.OPEN,
    close: async () => {
      engine.methods.unmount();
      await flushPorts();
    },
    refuseNextStart: host.refuseNextStart,
    sent: () =>
      sockets
        .flatMap((socket) => socket.sent)
        .map((message) =>
          typeof message === 'string' ? readMessageType(message) : 'packet',
        ),
    sung: (takeId) => sung.get(takeId) ?? [],
  };
};
