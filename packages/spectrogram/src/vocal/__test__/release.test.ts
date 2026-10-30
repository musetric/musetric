import { describe, expect, it } from 'vitest';
import { detectReleases } from '../release.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const phrase = (overrides: Partial<ToneSpec> = {}): ToneSpec => ({
  start: 1,
  duration: 0.8,
  frequency: 220,
  ...overrides,
});

const analyze = async (tone: ToneSpec) =>
  analyzeSynthetic(synthesizeVoice(2.6, [tone]));

describe('vocal releases', () => {
  it('asks for the fall the singer ends the phrase with', async () => {
    const lead = await analyze(phrase({ fallCents: -300, fallSeconds: 0.15 }));
    const take = await analyze(phrase({ fallSeconds: 0.15 }));
    const [mark] = detectReleases(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('fall');
    expect(mark.lead.fallCents).toBeLessThan(-100);
  });

  it('asks to hold the last note as long as the singer', async () => {
    const lead = await analyze(phrase({ duration: 1.2 }));
    const take = await analyze(phrase({ duration: 0.7 }));
    const [mark] = detectReleases(lead, take);
    expect(mark.advice).toBe('longer');
    expect(mark.lead.holdMs - (mark.take?.holdMs ?? 0)).toBeGreaterThan(400);
  });

  it('matches the same ending', async () => {
    const lead = await analyze(phrase({ fallCents: -300, fallSeconds: 0.15 }));
    const take = await analyze(phrase({ fallCents: -300, fallSeconds: 0.15 }));
    const [mark] = detectReleases(lead, take);
    expect(mark.status).toBe('match');
  });
});
