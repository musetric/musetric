import { describe, expect, it } from 'vitest';
import { detectDynamics } from '../dynamics.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const note = (overrides: Partial<ToneSpec> = {}): ToneSpec => ({
  start: 0.5,
  duration: 1.2,
  frequency: 262,
  ...overrides,
});

const analyze = async (tone: ToneSpec) =>
  analyzeSynthetic(synthesizeVoice(2.2, [tone]));

describe('vocal dynamics', () => {
  it('asks to swell through the note like the singer', async () => {
    const lead = await analyze(note({ riseSeconds: 0.9 }));
    const take = await analyze(note());
    const [mark] = detectDynamics(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('swell');
    expect(mark.lead.slopeDbPerSecond).toBeGreaterThan(4);
  });

  it('asks to fade through the note like the singer', async () => {
    const lead = await analyze(note({ fallSeconds: 0.9 }));
    const take = await analyze(note());
    const [mark] = detectDynamics(lead, take);
    expect(mark.advice).toBe('fade');
  });

  it('asks to hold a steady level where the singer does', async () => {
    const lead = await analyze(note());
    const take = await analyze(note({ fallSeconds: 0.9 }));
    const [mark] = detectDynamics(lead, take);
    expect(mark.advice).toBe('steady');
  });

  it('leaves a steady note of both voices without a mark', async () => {
    const lead = await analyze(note());
    const take = await analyze(note());
    expect(detectDynamics(lead, take)).toHaveLength(0);
  });
});
