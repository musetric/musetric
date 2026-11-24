import { type StemType, stemTypes } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';
import { playerChannel, playerDataChannel } from '../protocol.cross.js';
import { createPlayerRuntime } from '../runtime.worklet.js';
import { blockSize, rate, settle, sine } from './player.fixtures.js';
import { loadStretch } from './stretchModule.js';

const songFrames = 30 * rate;
const pageFrames = 20 * rate;
const latencyFrameCount = rate / 2;
const warmQuanta = 3000;
const measuredQuanta = 2000;
const windowLimit = 3;
const glideQuanta = 150;
const warmGlides = 6;
const measuredGlides = 10;
const glideTimeout = 30_000;
const growingShare = 0.01;
const postingShare = 0.1;

const frequencies: Record<StemType, number> = {
  lead: 440,
  backing: 220,
  instrumental: 110,
};

const keptUsage = { value: process.memoryUsage() };

const readHeapBytes = () => {
  keptUsage.value = process.memoryUsage();
  return keptUsage.value.heapUsed + keptUsage.value.arrayBuffers;
};

const createPlayer = async (withheld: boolean) => {
  const control = new MessageChannel();
  const data = new MessageChannel();
  const playhead = new MessageChannel();
  const counter = { posts: 0 };
  for (const port of [control.port1, data.port1, playhead.port1]) {
    const post = port.postMessage.bind(port);
    Object.assign(port, {
      postMessage: (message: unknown, transfer: Transferable[] = []) => {
        counter.posts += 1;
        post(message, transfer);
      },
    });
  }
  let contextFrame = 0;
  const runtime = createPlayerRuntime({
    port: playerChannel.inbound(control.port1),
    dataPort: playerDataChannel.inbound(data.port1),
    playheadPorts: [playhead.port1],
    sampleRate: rate,
    stretch: loadStretch(),
    getCurrentFrame: () => contextFrame,
  });
  const dataPort = playerDataChannel.outbound(data.port2);
  dataPort.bindHandlers({ requestWindow: () => undefined });
  const layout = { frameCount: songFrames, pageStarts: [0, pageFrames] };
  dataPort.methods.mount({
    frameCount: songFrames,
    layouts: { lead: layout, backing: layout, instrumental: layout },
    residentPageLimit: 2 * stemTypes.length,
    recording: [],
  });
  for (const stem of stemTypes) {
    const tone = sine(frequencies[stem], songFrames);
    dataPort.methods.putPage({
      stem,
      index: 0,
      frameCount: pageFrames,
      channelCount: 1,
      samples: tone.slice(0, pageFrames),
    });
    if (!withheld) {
      dataPort.methods.putPage({
        stem,
        index: 1,
        frameCount: songFrames - pageFrames,
        channelCount: 1,
        samples: tone.slice(pageFrames),
      });
    }
  }
  await settle();

  const player = playerChannel.outbound(control.port2).methods;
  const inputs = [[new Float32Array(blockSize)]];
  const outputs = [new Float32Array(blockSize), new Float32Array(blockSize)];
  const step = () => {
    runtime.process(inputs, outputs);
    contextFrame += blockSize;
  };
  return {
    player,
    counter,
    step,
    run: async (quanta: number) => {
      for (let quantum = 0; quantum < quanta; quantum += 1) {
        step();
      }
      await settle();
    },
    play: async () => {
      player.setOutputClock({ clockOffset: contextFrame / rate - 1.234_567 });
      player.play({
        command: 0,
        revision: 1,
        latencyFrameCount,
        inputLatencyFrameCount: 0,
      });
      await settle();
    },
  };
};

type Growth = {
  quanta: number;
  collecting: number;
  posting: number;
  silent: number;
  growing: number;
  grownBytes: number;
};

const createGrowth = (): Growth => ({
  quanta: 0,
  collecting: 0,
  posting: 0,
  silent: 0,
  growing: 0,
  grownBytes: 0,
});

type Player = Awaited<ReturnType<typeof createPlayer>>;

const measure = (player: Player, quanta: number, growth: Growth): void => {
  const bytes = new Float64Array(quanta);
  const posted = new Uint8Array(quanta);
  for (let quantum = 0; quantum < quanta; quantum += 1) {
    const { posts } = player.counter;
    const start = readHeapBytes();
    const before = readHeapBytes();
    player.step();
    const after = readHeapBytes();
    bytes[quantum] =
      before < start || after < before
        ? Number.NaN
        : after - before - (before - start);
    posted[quantum] = player.counter.posts === posts ? 0 : 1;
  }
  growth.quanta += quanta;
  for (let quantum = 0; quantum < quanta; quantum += 1) {
    if (Number.isNaN(bytes[quantum])) {
      growth.collecting += 1;
    } else if (posted[quantum] === 1) {
      growth.posting += 1;
    } else {
      growth.silent += 1;
      if (bytes[quantum] > 0) {
        growth.growing += 1;
        growth.grownBytes += bytes[quantum];
      }
    }
  }
};

const quiet = (growth: Growth) =>
  growth.growing <= growth.silent * growingShare;

const measureQuietest = (player: Player): Growth => {
  let quietest = createGrowth();
  measure(player, measuredQuanta, quietest);
  for (let window = 1; window < windowLimit && !quiet(quietest); window += 1) {
    const growth = createGrowth();
    measure(player, measuredQuanta, growth);
    if (growth.growing < quietest.growing) {
      quietest = growth;
    }
  }
  return quietest;
};

const expectNoGrowth = (growth: Growth) => {
  const report = JSON.stringify(growth);
  expect(growth.posting, report).toBeLessThanOrEqual(
    growth.quanta * postingShare,
  );
  expect(growth.growing, report).toBeLessThanOrEqual(
    growth.silent * growingShare,
  );
};

describe('player allocation', () => {
  it('grows no heap while it plays with the metronome', async () => {
    const player = await createPlayer(false);
    player.player.setMetronome({
      beatsInSamples: Int32Array.from({ length: 60 }, (_, beat) =>
        Math.round((beat * rate) / 2),
      ),
      downbeatMask: Uint8Array.from({ length: 60 }, (_, beat) =>
        beat % 4 === 0 ? 1 : 0,
      ),
      enabled: true,
      volume: 1,
    });
    await player.play();
    await player.run(warmQuanta);
    expectNoGrowth(measureQuietest(player));
  });

  it('grows no heap while it plays a loop slower and higher', async () => {
    const player = await createPlayer(false);
    player.player.setTempoRatio({ tempoRatio: 0.75 });
    player.player.setTransposeSemitones({ transposeSemitones: 3 });
    player.player.setRange({
      command: 0,
      range: { fromFrame: rate, toFrame: 3 * rate },
      repeat: 'cycle',
    });
    player.player.setMetronome({
      beatsInSamples: Int32Array.from({ length: 8 }, (_, beat) =>
        Math.round(rate + (beat * rate) / 4),
      ),
      downbeatMask: new Uint8Array(0),
      enabled: true,
      volume: 0.5,
    });
    player.player.seek({ command: 0, frameIndex: rate, revision: 1 });
    await player.play();
    await player.run(warmQuanta);
    expectNoGrowth(measureQuietest(player));
  });

  it('grows no heap while it holds', async () => {
    const player = await createPlayer(false);
    await player.play();
    await player.run(10);
    player.player.setFrozen({ command: 0, frozen: true });
    await settle();
    await player.run(warmQuanta);
    expectNoGrowth(measureQuietest(player));
  });

  it('grows no heap while a page is missing', async () => {
    const player = await createPlayer(true);
    player.player.seek({
      command: 0,
      frameIndex: pageFrames - rate,
      revision: 1,
    });
    await player.play();
    await player.run(warmQuanta);
    expectNoGrowth(measureQuietest(player));
  });

  it(
    'grows no heap while the cursor glides after Stop',
    async () => {
      const player = await createPlayer(false);
      player.player.setTempoRatio({ tempoRatio: 0.75 });
      const warming = createGrowth();
      const growth = createGrowth();
      for (let round = 0; round < warmGlides + measuredGlides; round += 1) {
        await player.play();
        await player.run(200);
        player.player.stop({ command: 0, revision: 1, frameIndex: 0 });
        await settle();
        measure(player, glideQuanta, round < warmGlides ? warming : growth);
        await settle();
      }
      expectNoGrowth(growth);
    },
    glideTimeout,
  );
});
