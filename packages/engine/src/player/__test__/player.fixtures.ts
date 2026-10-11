import { createRecordingStream } from '../../decoder/recordingStream.worker.js';
import {
  type LiveTakeChunk,
  playerChannel,
  playerDataChannel,
  type PlayerRecordingPiece,
} from '../protocol.cross.js';
import { recordingStreamChannel } from '../recordingStream.cross.js';
import { createPlayerRuntime } from '../runtime.worklet.js';

export const rate = 48000;
export const blockSize = 128;
export const timingTolerance = rate * 0.003;
export const burstSeconds = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
export const burstLength = 480;
const songSeconds = 8;
const burstFrequency = 1000;
const burstEnergyFloor = 0.01;

export const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const writeBurst = (target: Float32Array, start: number): void => {
  for (let index = 0; index < burstLength; index += 1) {
    const window = Math.sin((Math.PI * index) / burstLength) ** 2;
    target[start + index] =
      window * Math.sin((2 * Math.PI * burstFrequency * index) / rate);
  }
};

export const burstTrack = (
  seconds: readonly number[],
  length: number,
): Float32Array<ArrayBuffer> => {
  const track = new Float32Array(length);
  for (const second of seconds) {
    writeBurst(track, Math.round(second * rate));
  }
  return track;
};

export const burstCenters = (signal: Float32Array): number[] => {
  const centers: number[] = [];
  let weight = 0;
  let moment = 0;
  let quiet = 0;
  for (let index = 0; index < signal.length; index += 1) {
    const energy = signal[index] ** 2;
    if (energy > burstEnergyFloor) {
      weight += energy;
      moment += energy * index;
      quiet = 0;
    } else if (weight > 0 && (quiet += 1) > burstLength) {
      centers.push(moment / weight);
      weight = 0;
      moment = 0;
    }
  }
  return centers;
};

export const noise = (length: number): Float32Array<ArrayBuffer> => {
  let seed = 1;
  return Float32Array.from({ length }, () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.5;
  });
};

export type TakeStream = {
  chunks: LiveTakeChunk[];
  notification: MessagePort;
};

export const createTakeStream = (): TakeStream => {
  const stream = new MessageChannel();
  const chunks: LiveTakeChunk[] = [];
  createRecordingStream({
    port: recordingStreamChannel.outbound(stream.port2),
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
  });
  return { chunks, notification: stream.port1 };
};

export type Harness = TakeStream & {
  process: (input: Float32Array) => Float32Array;
  player: ReturnType<typeof playerChannel.outbound<MessagePort>>;
  data: ReturnType<typeof playerDataChannel.outbound<MessagePort>>;
};

export const createHarness = async (
  recording: PlayerRecordingPiece[],
): Promise<Harness> => {
  const control = new MessageChannel();
  const data = new MessageChannel();
  const runtime = await createPlayerRuntime({
    port: playerChannel.inbound(control.port1),
    dataPort: playerDataChannel.inbound(data.port1),
    playheadPorts: [],
    sampleRate: rate,
    getCurrentTime: () => 0,
  });
  const take = createTakeStream();
  const frameCount = songSeconds * rate;
  const dataPort = playerDataChannel.outbound(data.port2);
  dataPort.methods.mount({
    frameCount,
    tracks: {
      lead: [burstTrack(burstSeconds, frameCount)],
      backing: [new Float32Array(frameCount)],
      instrumental: [new Float32Array(frameCount)],
    },
    recording,
  });
  await settle();
  return {
    process: (input) => {
      const outputs = [
        new Float32Array(blockSize),
        new Float32Array(blockSize),
      ];
      runtime.process([[input]], outputs);
      return outputs[0];
    },
    player: playerChannel.outbound(control.port2),
    data: dataPort,
    ...take,
  };
};
