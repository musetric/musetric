import { createPlayhead } from '../../player/playhead.cross.js';
import { playerDataChannel } from '../../player/protocol.cross.js';
import { recordingStreamChannel } from '../../player/recordingStream.cross.js';
import { spectrogramDataChannel } from '../../spectrogram/protocol.cross.js';
import { engineDecoderChannel } from '../protocol.cross.js';
import { readRecordingPacket } from '../recordingStream.worker.js';
import { createDecoderWorkerRuntime } from '../runtime.worker.js';
import { type FakeSocket, stubSockets } from './fakeSocket.js';

export const takeRate = 48000;
const chunkFrameCount = 480;

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

const sample = (frame: number) => frame / takeRate;

type SentMessage = {
  type: string;
  sessionId?: string;
};

const readSent = (message: string | ArrayBuffer): SentMessage => {
  if (typeof message !== 'string') {
    return { type: 'packet' };
  }
  const parsed: SentMessage = JSON.parse(message);
  return parsed;
};

export type TakeHost = {
  socket: () => FakeSocket;
  received: string[];
  record: () => Promise<string>;
  sing: (offset: number, length: number) => void;
  stop: () => Promise<void>;
  sent: () => string[];
  delivered: () => number;
};

export const createTakeHost = async (): Promise<TakeHost> => {
  const sockets = stubSockets();
  const control = new MessageChannel();
  const player = new MessageChannel();
  const spectrogram = new MessageChannel();
  const playhead = new MessageChannel();
  createDecoderWorkerRuntime({
    port: engineDecoderChannel.inbound(control.port1),
    playerPort: playerDataChannel.outbound(player.port1),
    spectrogramPort: spectrogramDataChannel.outbound(spectrogram.port1),
    playhead: createPlayhead(playhead.port1, takeRate),
  });
  const received: string[] = [];
  control.port2.onmessage = (event: MessageEvent<{ type: string }>) => {
    received.push(event.data.type);
  };
  const engine = engineDecoderChannel.outbound(control.port2);
  engine.methods.mount({ projectId: 1, sampleRate: takeRate });
  await flushPorts();
  sockets[0].open();

  let worklet:
    ReturnType<typeof recordingStreamChannel.inbound<MessagePort>> | undefined =
    undefined;
  let sequence = 0;
  const sent = () => sockets.flatMap((socket) => socket.sent).map(readSent);
  const packets = () =>
    sockets
      .flatMap((socket) => socket.sent)
      .filter((message) => typeof message !== 'string')
      .map(readRecordingPacket);

  return {
    socket: () => sockets[sockets.length - 1],
    received,
    record: async () => {
      const stream = new MessageChannel();
      worklet = recordingStreamChannel.inbound(stream.port2);
      sequence = 0;
      engine.methods.startRecordingStream({
        projectId: 1,
        sampleRate: takeRate,
        frameCount: takeRate * 60,
        latencyFrameCount: 0,
        tempo: 1,
        transpose: 0,
        octave: 0,
        draft: false,
        port: stream.port1,
      });
      await flushPorts();
      const starts = sent().filter(
        (message) => message.type === 'recording.start',
      );
      return starts[starts.length - 1].sessionId ?? '';
    },
    sing: (offset, length) => {
      for (let at = offset; at < offset + length; at += chunkFrameCount) {
        sequence += 1;
        worklet?.methods.chunk({
          sequence,
          startFrame: 0,
          offset: at,
          samples: Float32Array.from(
            { length: Math.min(chunkFrameCount, offset + length - at) },
            (_, index) => sample(at + index),
          ),
        });
      }
    },
    stop: async () => {
      sequence += 1;
      worklet?.methods.flush({ sequence });
      engine.methods.finishRecordingStream({ sequence });
      await flushPorts();
    },
    sent: () => sent().map((message) => message.type),
    delivered: () => {
      let frames = 0;
      for (const packet of packets()) {
        if (packet.offset !== frames) {
          return frames;
        }
        const last = packet.samples.length - 1;
        if (packet.samples[last] !== Math.fround(sample(frames + last))) {
          return frames;
        }
        frames += packet.samples.length;
      }
      return frames;
    },
  };
};
