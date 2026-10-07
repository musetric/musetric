import { describe, expect, it } from 'vitest';
import { createRecordingStream } from '../../decoder/recordingStream.worker.js';
import {
  playerChannel,
  playerDataChannel,
  type PlayerRecordingPiece,
} from '../protocol.cross.js';
import { recordingStreamChannel } from '../recordingStream.cross.js';
import { createPlayerRuntime } from '../runtime.worklet.js';

const rate = 48000;
const blockSize = 128;
const inputLatency = 384;
const songSeconds = 8;
const burstSeconds = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const burstLength = 480;
const burstFrequency = 1000;
const burstEnergyFloor = 0.01;
const timingTolerance = rate * 0.003;

const settle = async (): Promise<void> => {
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

const burstTrack = (
  seconds: readonly number[],
  length: number,
): Float32Array<ArrayBuffer> => {
  const track = new Float32Array(length);
  for (const second of seconds) {
    writeBurst(track, Math.round(second * rate));
  }
  return track;
};

const burstCenters = (signal: Float32Array): number[] => {
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

const nearestError = (value: number, targets: readonly number[]): number =>
  targets.reduce(
    (best, target) =>
      Math.abs(value - target) < Math.abs(best) ? value - target : best,
    Number.POSITIVE_INFINITY,
  );

type TakeChunk = { frameIndex: number; samples: Float32Array };

type Harness = {
  process: (input: Float32Array) => Float32Array;
  player: ReturnType<typeof playerChannel.outbound<MessagePort>>;
  chunks: TakeChunk[];
  notification: MessagePort;
};

const createHarness = async (
  recording: PlayerRecordingPiece[],
): Promise<Harness> => {
  const control = new MessageChannel();
  const data = new MessageChannel();
  const stream = new MessageChannel();
  const runtime = await createPlayerRuntime({
    port: playerChannel.inbound(control.port1),
    dataPort: playerDataChannel.inbound(data.port1),
    playheadPorts: [],
    sampleRate: rate,
    getCurrentTime: () => 0,
  });
  const chunks: TakeChunk[] = [];
  createRecordingStream({
    port: recordingStreamChannel.outbound(stream.port2),
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
  });
  const frameCount = songSeconds * rate;
  playerDataChannel.outbound(data.port2).methods.mount({
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
    chunks,
    notification: stream.port1,
  };
};

type Loopback = {
  tempo: number;
  startSeconds: number;
  outputLatency: number;
};

const recordThroughLoopback = async (loopback: Loopback) => {
  const { tempo, startSeconds, outputLatency } = loopback;
  const roundTrip = outputLatency + inputLatency;
  const harness = await createHarness([]);
  const startFrame = Math.round(startSeconds * rate);
  harness.player.methods.setTempoRatio({ tempoRatio: tempo });
  harness.player.methods.seek({ frameIndex: startFrame, revision: 1 });
  harness.player.methods.startRecording({
    frameIndex: startFrame,
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: inputLatency,
    notificationPort: harness.notification,
  });
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: inputLatency,
  });
  await settle();
  const played: number[] = [];
  const blocks = Math.ceil(
    ((5.25 - startSeconds) / tempo) * (rate / blockSize),
  );
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(blockSize);
    for (let index = 0; index < blockSize; index += 1) {
      input[index] = played[block * blockSize + index - roundTrip] ?? 0;
    }
    played.push(...harness.process(input));
  }
  harness.player.methods.flushRecording();
  await settle();
  const [first] = harness.chunks;
  const anchor = first.frameIndex;
  const last = harness.chunks.at(-1) ?? first;
  const take = new Float32Array(last.frameIndex - anchor + last.samples.length);
  for (const chunk of harness.chunks) {
    take.set(chunk.samples, chunk.frameIndex - anchor);
  }
  return burstCenters(take).map((center) => anchor + center * tempo);
};

const songCenters = burstSeconds.map(
  (second) => second * rate + (burstLength - 1) / 2,
);

describe('player recording loopback', () => {
  it('places a take recorded at the original tempo on the song', async () => {
    const centers = await recordThroughLoopback({
      tempo: 1,
      startSeconds: 0.75,
      outputLatency: 512,
    });
    expect(centers.length).toBeGreaterThan(5);
    for (const center of centers) {
      expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(1);
    }
  });

  it.each([0.5, 0.8, 1.25])(
    'places a take recorded at tempo %f on the song',
    async (tempo) => {
      const centers = await recordThroughLoopback({
        tempo,
        startSeconds: 0.75,
        outputLatency: 512,
      });
      expect(centers.length).toBeGreaterThan(5);
      for (const center of centers) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );

  it.each([0.5, 0.8, 1.25])(
    'places a take started at the song start at tempo %f',
    async (tempo) => {
      const centers = await recordThroughLoopback({
        tempo,
        startSeconds: 0,
        outputLatency: rate / 10,
      });
      expect(centers.length).toBeGreaterThan(5);
      for (const center of centers) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );
});

const noise = (length: number): Float32Array<ArrayBuffer> => {
  let seed = 1;
  return Float32Array.from({ length }, () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.5;
  });
};

type VoicePlayback = {
  raw: Float32Array<ArrayBuffer>;
  pieceTempo: number;
  playTempo: number;
};

const playVoice = async (playback: VoicePlayback) => {
  const { raw, pieceTempo, playTempo } = playback;
  const songStart = Math.round(2 * rate);
  const harness = await createHarness([
    { songStartFrame: songStart, tempo: pieceTempo, samples: raw.slice() },
  ]);
  harness.player.methods.setTempoRatio({ tempoRatio: playTempo });
  harness.player.methods.setTrackVolume({ stemType: 'lead', volume: 0 });
  harness.player.methods.seek({ frameIndex: songStart, revision: 1 });
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: 0,
    inputLatencyFrameCount: 0,
  });
  await settle();
  const played: number[] = [];
  const blocks = Math.ceil(
    ((raw.length * pieceTempo) / playTempo + rate * 0.2) / blockSize,
  );
  for (let block = 0; block < blocks; block += 1) {
    played.push(...harness.process(new Float32Array(blockSize)));
  }
  return Float32Array.from(played);
};

describe('player voice', () => {
  it.each([0.5, 0.8, 0.9, 1.1])(
    'plays a take at its own tempo %f exactly as it was sung',
    async (tempo) => {
      const raw = noise(rate);
      const played = await playVoice({
        raw,
        pieceTempo: tempo,
        playTempo: tempo,
      });
      expect(Array.from(played.subarray(0, raw.length))).toEqual(
        Array.from(raw),
      );
    },
  );

  it('plays a take at another tempo from the raw take in step with the song', async () => {
    const pieceTempo = 0.5;
    const playTempo = 1;
    const raw = burstTrack([0.25, 0.75, 1.25], Math.round(1.5 * rate));
    const played = await playVoice({ raw, pieceTempo, playTempo });
    const sung = burstCenters(raw).map(
      (center) => (center * pieceTempo) / playTempo,
    );
    const heard = burstCenters(played);
    expect(heard).toHaveLength(sung.length);
    heard.forEach((center, index) => {
      expect(Math.abs(center - sung[index])).toBeLessThan(timingTolerance);
    });
  });

  it('leaves nothing of the previous take after a seek', async () => {
    const loud = { songStartFrame: rate, tempo: 0.5, samples: noise(rate) };
    const silent = {
      songStartFrame: 3 * rate,
      tempo: 0.5,
      samples: new Float32Array(rate),
    };
    const harness = await createHarness([loud, silent]);
    harness.player.methods.setTrackVolume({ stemType: 'lead', volume: 0 });
    harness.player.methods.seek({ frameIndex: rate, revision: 1 });
    harness.player.methods.play({
      revision: 1,
      latencyFrameCount: 0,
      inputLatencyFrameCount: 0,
    });
    await settle();
    let loudPeak = 0;
    for (let block = 0; block < 100; block += 1) {
      for (const value of harness.process(new Float32Array(blockSize))) {
        loudPeak = Math.max(loudPeak, Math.abs(value));
      }
    }
    harness.player.methods.seek({ frameIndex: 3.1 * rate, revision: 2 });
    await settle();
    let stalePeak = 0;
    for (let block = 0; block < 100; block += 1) {
      for (const value of harness.process(new Float32Array(blockSize))) {
        stalePeak = Math.max(stalePeak, Math.abs(value));
      }
    }
    expect(loudPeak).toBeGreaterThan(0.1);
    expect(stalePeak).toBeLessThan(1e-4);
  });
});
