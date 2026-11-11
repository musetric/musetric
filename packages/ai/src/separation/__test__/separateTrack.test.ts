import { describe, expect, it } from 'vitest';
import {
  separateTrack,
  type SeparateTrackOptions,
  type SeparationCommit,
  type SeparationSource,
} from '../separateTrack.js';
import { type SeparationGeometry } from '../separationPlan.js';
import { peakOf, stemNames, type StemValues } from '../separationStems.js';

const geometry: SeparationGeometry = { sampleRate: 4, chunkSamples: 44 };
const frames = 150;

const mixture = [0, 1].map((channel) =>
  Float32Array.from(
    { length: frames },
    (_, frame) => 1.2 * Math.sin(frame / (5 + channel)) * Math.cos(frame / 17),
  ),
);

const source: SeparationSource = {
  frames,
  peak: async () => Promise.resolve(Math.max(...mixture.map(peakOf))),
  read: async (start, channels) => {
    for (const [channel, samples] of channels.entries()) {
      samples.set(mixture[channel].subarray(start, start + samples.length));
    }
    return Promise.resolve();
  },
};

type Run = {
  commits: SeparationCommit[];
  reported: number[];
  loads: number;
  processed: number;
  scales: StemValues;
};

const run = async (resume?: Uint8Array): Promise<Run> => {
  const found: Omit<Run, 'scales'> = {
    commits: [],
    reported: [],
    loads: 0,
    processed: 0,
  };
  const options: SeparateTrackOptions = {
    geometry,
    channels: 2,
    masks: 2,
    source,
    resume,
    loadModel: async () => {
      found.loads += 1;
      return Promise.resolve({
        processChunk: async (chunk) => {
          const { input, output } = chunk;
          found.processed += 1;
          const size = geometry.chunkSamples;
          for (let channel = 0; channel < 2; channel += 1) {
            for (let position = 0; position < size; position += 1) {
              const value = input[channel * size + position];
              output[channel * size + position] = value * 0.5;
              output[(channel + 2) * size + position] = value * 0.25;
            }
          }
          return Promise.resolve();
        },
        release: async () => Promise.resolve(),
      });
    },
    report: (unit) => {
      found.reported.push(unit);
    },
    commit: async (commit) => {
      found.commits.push(commit);
      return Promise.resolve();
    },
  };
  const scales = await separateTrack(options);
  return { ...found, scales };
};

const stemBytes = (commits: SeparationCommit[]): number[][] =>
  stemNames.map((name) =>
    commits.flatMap((commit) =>
      Array.from(new Uint32Array(commit.stems[name].buffer)),
    ),
  );

describe('separateTrack', () => {
  it('commits every unit in order and covers the track once', async () => {
    const found = await run();
    expect(found.commits.map((commit) => commit.unit)).toEqual([0, 1, 2, 3, 4]);
    expect(found.commits.every((commit) => commit.unitCount === 5)).toBe(true);
    expect(found.reported).toEqual([0, 1, 2, 3, 4]);
    expect(found.loads).toBe(1);
    for (const name of stemNames) {
      const length = found.commits.reduce(
        (sum, commit) => sum + commit.stems[name].length,
        0,
      );
      expect(length).toBe(frames * 2);
    }
  });

  it('separates a normalized mixture into its stems', async () => {
    const found = await run();
    const peak = Math.max(
      ...mixture.flatMap((channel) => Array.from(channel, Math.abs)),
    );
    const scale = 0.9 / peak;
    const shares = {
      vocals: 0.5,
      instrumental: 0.5,
      lead: 0.25,
      backing: 0.25,
    };
    for (const name of stemNames) {
      const values = found.commits.flatMap((commit) =>
        Array.from(commit.stems[name]),
      );
      for (const [index, value] of values.entries()) {
        const expected =
          mixture[index % 2][Math.floor(index / 2)] * scale * shares[name];
        expect(value).toBeCloseTo(expected, 5);
      }
    }
    expect(found.scales).toEqual({
      vocals: 1,
      instrumental: 1,
      lead: 1,
      backing: 1,
    });
  });

  it('resumes after any unit to the same bytes', async () => {
    const whole = await run();
    for (const [index, commit] of whole.commits.entries()) {
      const resumed = await run(commit.state);
      expect(resumed.processed).toBe(whole.commits.length - index - 1);
      expect(resumed.scales).toEqual(whole.scales);
      expect(
        stemBytes([...whole.commits.slice(0, index + 1), ...resumed.commits]),
      ).toEqual(stemBytes(whole.commits));
      expect(resumed.commits.map((next) => Array.from(next.state))).toEqual(
        whole.commits.slice(index + 1).map((next) => Array.from(next.state)),
      );
    }
  });

  it('answers without the model when no unit is left', async () => {
    const whole = await run();
    const resumed = await run(whole.commits.at(-1)?.state);
    expect(resumed.loads).toBe(0);
    expect(resumed.commits).toEqual([]);
    expect(resumed.scales).toEqual(whole.scales);
  });

  it('starts again from the first unit when the state is not of this track', async () => {
    const found = await run(new Uint8Array(16));
    expect(found.commits.map((commit) => commit.unit)).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs the next unit while the last one is committed, one commit at a time', async () => {
    const events: string[] = [];
    let open = 0;
    await separateTrack({
      geometry,
      channels: 2,
      masks: 2,
      source,
      loadModel: async () =>
        Promise.resolve({
          processChunk: async () => {
            events.push('chunk');
            return Promise.resolve();
          },
          release: async () => Promise.resolve(),
        }),
      report: () => undefined,
      commit: async (commit) => {
        open += 1;
        expect(open).toBe(1);
        events.push(`commit ${String(commit.unit)}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`committed ${String(commit.unit)}`);
        open -= 1;
      },
    });
    expect(events.slice(0, 5)).toEqual([
      'chunk',
      'commit 0',
      'chunk',
      'committed 0',
      'commit 1',
    ]);
    expect(events.at(-1)).toBe('committed 4');
  });

  it('fails when a commit fails', async () => {
    await expect(
      separateTrack({
        geometry,
        channels: 2,
        masks: 2,
        source,
        loadModel: async () =>
          Promise.resolve({
            processChunk: async () => Promise.resolve(),
            release: async () => Promise.resolve(),
          }),
        report: () => undefined,
        commit: async (commit) =>
          commit.unit === 1
            ? Promise.reject(new Error('the host refused'))
            : Promise.resolve(),
      }),
    ).rejects.toThrow('the host refused');
  });

  it('refuses a model that is not stereo with two masks', async () => {
    await expect(
      separateTrack({
        geometry,
        channels: 1,
        masks: 2,
        source,
        loadModel: async () => Promise.reject(new Error('unused')),
        report: () => undefined,
        commit: async () => Promise.resolve(),
      }),
    ).rejects.toThrow('stereo');
  });
});
