import { describe, expect, it } from 'vitest';
import { detectOnsets } from '../onset.js';
import {
  analyzeSynthetic,
  type NoiseSpec,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const phrase = (overrides: Partial<ToneSpec> = {}): ToneSpec => ({
  start: 1,
  duration: 0.8,
  frequency: 220,
  ...overrides,
});

const analyze = async (tone: ToneSpec, noises: NoiseSpec[] = []) =>
  analyzeSynthetic(synthesizeVoice(2.5, [tone], noises));

const breath: NoiseSpec = { start: 0.92, duration: 0.08, level: 0.05 };

describe('vocal onsets', () => {
  it('asks for a softer attack where the singer swells in', async () => {
    const lead = await analyze(phrase({ riseSeconds: 0.12 }));
    const take = await analyze(phrase({ riseSeconds: 0.003 }));
    const [mark] = detectOnsets(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('softer');
    expect(mark.lead.riseMs).toBeGreaterThan(mark.take?.riseMs ?? 0);
  });

  it('asks for the breath the singer puts before the vowel', async () => {
    const lead = await analyze(phrase(), [breath]);
    const take = await analyze(phrase());
    const [mark] = detectOnsets(lead, take);
    expect(mark.advice).toBe('moreLeadIn');
    expect(mark.lead.leadInMs).toBeGreaterThanOrEqual(60);
    expect(mark.take?.leadInMs).toBeLessThan(20);
  });

  it('asks for the scoop the singer starts the phrase with', async () => {
    const lead = await analyze(
      phrase({ scoopCents: -150, scoopSeconds: 0.12 }),
    );
    const take = await analyze(phrase());
    const [mark] = detectOnsets(lead, take);
    expect(mark.advice).toBe('scoop');
    expect(mark.lead.scoopCents).toBeLessThan(-60);
  });

  it('matches the same attack', async () => {
    const lead = await analyze(phrase({ riseSeconds: 0.12 }), [breath]);
    const take = await analyze(phrase({ riseSeconds: 0.12 }), [breath]);
    const [mark] = detectOnsets(lead, take);
    expect(mark.status).toBe('match');
  });

  it('names the singer attack before a take exists', async () => {
    const lead = await analyze(phrase({ riseSeconds: 0.12 }));
    const [mark] = detectOnsets(lead, undefined);
    expect(mark.status).toBe('trait');
    expect(mark.advice).toBe('softer');
  });
});
