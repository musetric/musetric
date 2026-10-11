import { describe, expect, it } from 'vitest';
import {
  blockSize,
  burstCenters,
  burstTrack,
  createHarness,
  noise,
  rate,
  settle,
  timingTolerance,
} from './player.fixtures.js';

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

  it('plays the run of a live take that was sung last', async () => {
    const harness = await createHarness([]);
    harness.player.methods.setTrackVolume({ stemType: 'lead', volume: 0 });
    harness.data.methods.beginLiveTake({ takeId: 'take', tempo: 1 });
    harness.data.methods.appendLiveTake({
      startFrame: rate,
      offset: 0,
      samples: noise(rate),
    });
    harness.data.methods.appendLiveTake({
      startFrame: 1.25 * rate,
      offset: 0,
      samples: new Float32Array(rate / 4),
    });
    harness.player.methods.play({
      revision: 1,
      latencyFrameCount: 0,
      inputLatencyFrameCount: 0,
    });
    const peakFrom = async (frameIndex: number, revision: number) => {
      harness.player.methods.seek({ frameIndex, revision });
      await settle();
      let peak = 0;
      for (let block = 0; block < 50; block += 1) {
        for (const value of harness.process(new Float32Array(blockSize))) {
          peak = Math.max(peak, Math.abs(value));
        }
      }
      return peak;
    };
    expect(await peakFrom(1.3 * rate, 2)).toBeLessThan(1e-4);
    expect(await peakFrom(1.6 * rate, 3)).toBeGreaterThan(0.1);
  });
});
