import { stemTypes } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';
import { fadeFrameCount } from '../playerRange.worklet.js';
import { playerChannel, playerDataChannel } from '../protocol.cross.js';
import { createPlayerRuntime } from '../runtime.worklet.js';
import {
  blockSize,
  fadeQuanta,
  rate,
  settle,
  sine,
} from './player.fixtures.js';
import { loadStretch } from './stretchModule.js';

const songFrames = 4 * rate;
const pageStarts = [0, 48_000, 96_000, 144_000];
const lead = sine(440, songFrames);
const silence = new Float32Array(songFrames);

const createPlayer = async (withheld: number[] = []) => {
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
  const layout = { frameCount: songFrames, pageStarts };
  dataPort.methods.mount({
    frameCount: songFrames,
    layouts: { lead: layout, backing: layout, instrumental: layout },
    residentPageLimit: stemTypes.length * pageStarts.length,
    recording: [],
  });
  const putPages = async (indices: number[]) => {
    for (const stem of stemTypes) {
      const signal = stem === 'lead' ? lead : silence;
      for (const index of indices) {
        const start = pageStarts[index];
        const end = pageStarts.at(index + 1) ?? songFrames;
        dataPort.methods.putPage({
          stem,
          index,
          frameCount: end - start,
          channelCount: 1,
          samples: signal.slice(start, end),
        });
      }
    }
    await settle();
  };
  await putPages(
    pageStarts.map((_, index) => index).filter((i) => !withheld.includes(i)),
  );
  const output: number[] = [];
  return {
    player: playerChannel.outbound(control.port2).methods,
    putPages,
    output,
    render: (quanta: number) => {
      for (let quantum = 0; quantum < quanta; quantum += 1) {
        const outputs = [
          new Float32Array(blockSize),
          new Float32Array(blockSize),
        ];
        runtime.process([[new Float32Array(blockSize)]], outputs);
        contextFrame += blockSize;
        output.push(...outputs[0]);
      }
    },
  };
};

const play = {
  command: 0,
  revision: 1,
  latencyFrameCount: 0,
  inputLatencyFrameCount: 0,
};

const largestStep = (samples: readonly number[]) =>
  samples.reduce(
    (largest, value, index) =>
      index === 0
        ? largest
        : Math.max(largest, Math.abs(value - samples[index - 1])),
    0,
  );

const steadyBound = (samples: readonly number[]) => {
  const steady = samples.slice(0, 50 * blockSize).slice(fadeFrameCount);
  const peak = Math.max(...steady.map(Math.abs));
  const bound = largestStep(steady) + peak / fadeFrameCount + 1e-6;
  expect(bound).toBeLessThan(peak / 4);
  return bound;
};

describe('the fades of a cut', () => {
  it('fades out before Stop and in after Play', async () => {
    const run = await createPlayer();
    run.player.play(play);
    await settle();
    run.render(100);
    const stoppedAt = run.output.length;
    run.player.stop({ command: 0, revision: 2, frameIndex: 0 });
    await settle();
    run.render(20);
    run.player.play({ ...play, revision: 3 });
    await settle();
    run.render(50);

    expect(largestStep(run.output)).toBeLessThanOrEqual(
      steadyBound(run.output),
    );
    const fading = run.output.slice(stoppedAt, stoppedAt + fadeFrameCount);
    expect(fading.every((value) => value !== 0)).toBe(true);
    const silent = run.output.slice(
      stoppedAt + fadeFrameCount,
      stoppedAt + 20 * blockSize,
    );
    expect(silent.every((value) => value === 0)).toBe(true);
  });

  it('fades a seek out at the old frame and in at the new one', async () => {
    const run = await createPlayer();
    run.player.play(play);
    await settle();
    run.render(100);
    run.player.seek({ command: 0, frameIndex: 2.5 * rate + 92, revision: 2 });
    await settle();
    run.render(fadeQuanta + 100);

    expect(largestStep(run.output)).toBeLessThanOrEqual(
      steadyBound(run.output),
    );
  });

  it('fades a hold for a missing page out and in', async () => {
    const run = await createPlayer([2]);
    run.player.play(play);
    await settle();
    run.render(800);
    const silentFrames = run.output.filter((value) => value === 0).length;
    await run.putPages([2]);
    run.render(300);

    expect(silentFrames).toBeGreaterThan(fadeFrameCount);
    expect(largestStep(run.output)).toBeLessThanOrEqual(
      steadyBound(run.output),
    );
  });
});
