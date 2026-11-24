import { type StemType, stemTypes } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';
import { fadeFrameCount } from '../playerRange.worklet.js';
import {
  playerChannel,
  playerDataChannel,
  type PlayerRange,
} from '../protocol.cross.js';
import { createPlayerRuntime } from '../runtime.worklet.js';
import {
  blockSize,
  mountTracks,
  noise,
  rate,
  settle,
  sine,
} from './player.fixtures.js';
import { loadStretch } from './stretchModule.js';

const songFrames = 4 * rate;
const pageStarts = [0, 30_011, 72_000, 96_000, 131_072, 144_000];
const loop: PlayerRange = { fromFrame: 60_000, toFrame: 100_000 };

const stems = (): Record<StemType, Float32Array<ArrayBuffer>[]> => ({
  lead: [noise(songFrames), sine(440, songFrames)],
  backing: [sine(220, songFrames)],
  instrumental: [noise(songFrames).map((value) => value / 2)],
});

const putPages = (
  data: ReturnType<typeof playerDataChannel.outbound<MessagePort>>,
  tracks: Record<StemType, Float32Array<ArrayBuffer>[]>,
  indices: readonly number[],
) => {
  for (const stem of stemTypes) {
    const channels = tracks[stem];
    for (const index of indices) {
      const start = pageStarts[index];
      const end = pageStarts[index + 1] ?? songFrames;
      const frameCount = end - start;
      const samples = new Float32Array(frameCount * channels.length);
      for (const [channel, values] of channels.entries()) {
        samples.set(values.subarray(start, end), channel * frameCount);
      }
      data.methods.putPage({
        stem,
        index,
        frameCount,
        channelCount: channels.length,
        samples,
      });
    }
  }
};

type Paging = 'whole' | 'pages';

const createPlayer = async (paging: Paging, withheld: number[] = []) => {
  const control = new MessageChannel();
  const data = new MessageChannel();
  let contextFrame = 0;
  const runtime = createPlayerRuntime({
    port: playerChannel.inbound(control.port1),
    dataPort: playerDataChannel.inbound(data.port1),
    playheadPorts: [],
    sampleRate: rate,
    stretch: loadStretch(),
    getCurrentTime: () => contextFrame / rate,
    getCurrentFrame: () => contextFrame,
  });
  const dataPort = playerDataChannel.outbound(data.port2);
  dataPort.bindHandlers({ requestWindow: () => undefined });
  const tracks = stems();
  if (paging === 'whole') {
    mountTracks(dataPort, songFrames, tracks, []);
  } else {
    const layout = { frameCount: songFrames, pageStarts };
    dataPort.methods.mount({
      frameCount: songFrames,
      layouts: { lead: layout, backing: layout, instrumental: layout },
      residentPageLimit: stemTypes.length * pageStarts.length,
      recording: [],
    });
    putPages(
      dataPort,
      tracks,
      pageStarts
        .map((_, index) => index)
        .filter((index) => !withheld.includes(index)),
    );
  }
  await settle();
  const player = playerChannel.outbound(control.port2).methods;
  return {
    player,
    putLate: async (indices: number[]) => {
      putPages(dataPort, tracks, indices);
      await settle();
    },
    render: (blocks: number) => {
      const rendered: Float32Array[] = [];
      for (let block = 0; block < blocks; block += 1) {
        const outputs = [
          new Float32Array(blockSize),
          new Float32Array(blockSize),
        ];
        runtime.process([[new Float32Array(blockSize)]], outputs);
        contextFrame += blockSize;
        rendered.push(outputs[0], outputs[1]);
      }
      return rendered;
    },
  };
};

const playScenario = async (paging: Paging, tempoRatio: number) => {
  const run = await createPlayer(paging);
  run.player.setTempoRatio({ tempoRatio });
  run.player.play({
    command: 0,
    revision: 1,
    latencyFrameCount: 0,
    inputLatencyFrameCount: 0,
  });
  await settle();
  const rendered = run.render(300);
  run.player.seek({ command: 0, frameIndex: 131_000, revision: 2 });
  await settle();
  rendered.push(...run.render(120));
  run.player.seek({ command: 0, frameIndex: 50_000, revision: 3 });
  run.player.setRange({ command: 0, range: loop, repeat: 'cycle' });
  await settle();
  rendered.push(...run.render(900));
  return rendered;
};

const cutGain = (frame: number, cut: number) => {
  if (frame >= cut - fadeFrameCount && frame < cut) {
    return (cut - frame) / fadeFrameCount;
  }
  if (frame >= cut && frame < cut + fadeFrameCount) {
    return (frame - cut) / fadeFrameCount;
  }
  return 1;
};

const fadeAround = (block: Float32Array, start: number, cut: number) =>
  block.map((value, frame) => value * cutGain(start + frame, cut));

const isSilent = (blocks: Float32Array[]) =>
  blocks.every((block) => block.every((value) => value === 0));

describe('player pages', () => {
  it('plays the pages of a stem to the bits of the whole stem', async () => {
    for (const tempoRatio of [1, 0.75]) {
      const whole = await playScenario('whole', tempoRatio);
      const paged = await playScenario('pages', tempoRatio);

      expect(paged).toEqual(whole);
      expect(isSilent(whole)).toBe(false);
    }
  });

  it('holds its position on a missing page and goes on from it when the page comes', async () => {
    const whole = await createPlayer('whole');
    const missing = await createPlayer('pages', [2]);
    for (const run of [whole, missing]) {
      run.player.play({
        command: 0,
        revision: 1,
        latencyFrameCount: 0,
        inputLatencyFrameCount: 0,
      });
    }
    await settle();
    const expected = whole.render(1200);

    const held = missing.render(500);
    await missing.putLate([2]);
    const after = missing.render(700);

    const blocks = [...held, ...after];
    const pairs = Array.from({ length: blocks.length / 2 }, (_, index) => [
      blocks[index * 2],
      blocks[index * 2 + 1],
    ]);
    const heldPairs = pairs.filter(isSilent).length;
    expect(heldPairs).toBeGreaterThan(0);
    expect(pairs.slice(-50).some((pair) => !isSilent(pair))).toBe(true);
    const played = pairs.filter((pair) => !isSilent(pair));
    const cut = pairs.findIndex(isSilent) * blockSize;
    const faded = played.map((_, index) => [
      fadeAround(expected[index * 2], index * blockSize, cut),
      fadeAround(expected[index * 2 + 1], index * blockSize, cut),
    ]);
    expect(played).toEqual(faded);
  });
});
