import { describe, expect, it } from 'vitest';
import { playerChannel, playerDataChannel } from '../protocol.cross.js';
import { createPlayerRuntime } from '../runtime.worklet.js';

const rate = 48000;
const blockSize = 128;
const latency = rate / 10;
const beatSeconds = 1;
const beat = beatSeconds * rate;
const start = rate / 2;

const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const createPlayer = async () => {
  const control = new MessageChannel();
  const data = new MessageChannel();
  const runtime = await createPlayerRuntime({
    port: playerChannel.inbound(control.port1),
    dataPort: playerDataChannel.inbound(data.port1),
    playheadPorts: [],
    sampleRate: rate,
    getCurrentTime: () => 0,
  });
  const silence = () => [new Float32Array(2 * rate)];
  playerDataChannel.outbound(data.port2).methods.mount({
    frameCount: 2 * rate,
    tracks: { lead: silence(), backing: silence(), instrumental: silence() },
    recording: [],
  });
  const player = playerChannel.outbound(control.port2).methods;
  player.setMetronome({
    beatsInSamples: Int32Array.of(beat),
    downbeatMask: new Uint8Array(0),
    enabled: true,
    volume: 1,
  });
  player.seek({ frameIndex: start, revision: 1 });

  const playClickAt = async (blocks: number): Promise<number> => {
    player.play({
      revision: 1,
      latencyFrameCount: latency,
      inputLatencyFrameCount: 0,
    });
    await settle();
    const played = new Float32Array(blocks * blockSize);
    for (let offset = 0; offset < played.length; offset += blockSize) {
      const outputs = [
        new Float32Array(blockSize),
        new Float32Array(blockSize),
      ];
      runtime.process([[new Float32Array(blockSize)]], outputs);
      played.set(outputs[0], offset);
    }
    return played.findIndex((value) => Math.abs(value) > 0.01) - 1;
  };
  const stop = async () => {
    player.stop({ revision: 1 });
    await settle();
  };
  return { playClickAt, stop };
};

describe('player metronome', () => {
  it('clicks together with the music rendered for the beat', async () => {
    const player = await createPlayer();
    expect(await player.playClickAt(rate / blockSize)).toBe(beat - start);
  });

  it('clicks again a beat that a stop cut off before it was heard', async () => {
    const player = await createPlayer();
    const blocks = Math.ceil((beat - start + latency / 2) / blockSize);
    await player.playClickAt(blocks);
    await player.stop();
    const heard = start + blocks * blockSize - latency;
    expect(await player.playClickAt(blocks)).toBe(beat - heard);
  });
});
