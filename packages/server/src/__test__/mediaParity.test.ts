import {
  analyzeLeadVisualLoudness,
  analyzeLoudness,
  convertToFlac,
  convertToFmp4,
  generateWavePeaks,
  getAudioFrameCount,
} from '@musetric/ffmpeg';
import { expect, test } from 'vitest';
import {
  sampleRate,
  silentLogger,
  withMediaWorkspace,
} from './mediaWorkspace.js';

const timeout = 300_000;

test(
  'both wrappers encode the same flac',
  async () => {
    const compared = await withMediaWorkspace(async (workspace) => {
      await convertToFlac({
        fromPath: workspace.fixturePath,
        toPath: workspace.path('node.flac'),
        sampleRate,
        logger: silentLogger,
      });
      await workspace.runRust([
        'flac',
        '--from',
        workspace.fixturePath,
        '--to',
        workspace.path('rust.flac'),
        '--sample-rate',
        String(sampleRate),
      ]);
      return {
        node: workspace.read('node.flac'),
        rust: workspace.read('rust.flac'),
      };
    });

    expect(compared.rust).toEqual(compared.node);
  },
  timeout,
);

test(
  'both wrappers encode the same fragmented mp4',
  async () => {
    const compared = await withMediaWorkspace(async (workspace) => {
      await convertToFmp4({
        fromPath: workspace.fixturePath,
        toPath: workspace.path('node.mp4'),
        sampleRate,
        logger: silentLogger,
      });
      await workspace.runRust([
        'fmp4',
        '--from',
        workspace.fixturePath,
        '--to',
        workspace.path('rust.mp4'),
        '--sample-rate',
        String(sampleRate),
      ]);
      return {
        node: workspace.read('node.mp4'),
        rust: workspace.read('rust.mp4'),
      };
    });

    expect(compared.rust).toEqual(compared.node);
  },
  timeout,
);

test(
  'both wrappers reduce the audio to the same peaks',
  async () => {
    const compared = await withMediaWorkspace(async (workspace) => {
      await generateWavePeaks({
        fromPath: workspace.fixturePath,
        toPath: workspace.path('node.bin'),
        sampleRate,
        logger: silentLogger,
      });
      await workspace.runRust([
        'peaks',
        '--from',
        workspace.fixturePath,
        '--to',
        workspace.path('rust.bin'),
        '--sample-rate',
        String(sampleRate),
      ]);
      return {
        node: workspace.read('node.bin'),
        rust: workspace.read('rust.bin'),
      };
    });

    expect(compared.rust).toEqual(compared.node);
  },
  timeout,
);

test(
  'both wrappers count the same frames',
  async () => {
    const compared = await withMediaWorkspace(async (workspace) => ({
      node: await getAudioFrameCount(
        workspace.fixturePath,
        sampleRate,
        silentLogger,
      ),
      rust: await workspace.runRust([
        'frames',
        '--from',
        workspace.fixturePath,
        '--sample-rate',
        String(sampleRate),
      ]),
    }));

    expect(Number(compared.rust)).toBe(compared.node);
  },
  timeout,
);

test(
  'both wrappers read the same loudness',
  async () => {
    const compared = await withMediaWorkspace(async (workspace) => ({
      node: await analyzeLoudness({
        fromPath: workspace.fixturePath,
        logger: silentLogger,
      }),
      rust: await workspace.readRust([
        'loudness',
        '--from',
        workspace.fixturePath,
      ]),
    }));

    expect(compared.rust).toEqual(compared.node);
  },
  timeout,
);

test(
  'both wrappers read the same lead loudness',
  async () => {
    const compared = await withMediaWorkspace(async (workspace) => ({
      node: await analyzeLeadVisualLoudness({
        fromPath: workspace.fixturePath,
        sampleRate,
        logger: silentLogger,
      }),
      rust: await workspace.readRust([
        'lead-loudness',
        '--from',
        workspace.fixturePath,
        '--sample-rate',
        String(sampleRate),
      ]),
    }));

    expect(compared.rust).toEqual(compared.node);
  },
  timeout,
);
