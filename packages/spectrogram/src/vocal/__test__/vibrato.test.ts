import { describe, expect, it } from 'vitest';
import { detectVibratos } from '../vibrato.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const note = (overrides: Partial<ToneSpec> = {}): ToneSpec => ({
  start: 0.5,
  duration: 1.6,
  frequency: 247,
  ...overrides,
});

const analyze = async (tone: ToneSpec) =>
  analyzeSynthetic(synthesizeVoice(2.6, [tone]));

describe('vocal vibrato', () => {
  it('measures the rate, the width and the delay of the vibrato', async () => {
    const lead = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 100, delay: 0.5 } }),
    );
    const [mark] = detectVibratos(lead, undefined);
    expect(mark.status).toBe('trait');
    expect(mark.lead.vibrato).toBe(true);
    expect(mark.lead.rateHz).toBeCloseTo(5.5, 0);
    expect(mark.lead.extentCents).toBeGreaterThan(70);
    expect(mark.lead.extentCents).toBeLessThan(110);
    expect(mark.lead.delayMs).toBeGreaterThan(350);
    expect(mark.lead.delayMs).toBeLessThan(650);
  });

  it('asks for the vibrato of the singer on a straight take', async () => {
    const lead = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 100, delay: 0.4 } }),
    );
    const take = await analyze(note());
    const [mark] = detectVibratos(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('add');
  });

  it('asks to start the vibrato later like the singer', async () => {
    const lead = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 100, delay: 0.7 } }),
    );
    const take = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 100, delay: 0.1 } }),
    );
    const [mark] = detectVibratos(lead, take);
    expect(mark.advice).toBe('later');
  });

  it('asks for a narrower vibrato', async () => {
    const lead = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 60, delay: 0.3 } }),
    );
    const take = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 180, delay: 0.3 } }),
    );
    const [mark] = detectVibratos(lead, take);
    expect(mark.advice).toBe('narrower');
  });

  it('leaves straight notes of both voices without a mark', async () => {
    const lead = await analyze(note());
    const take = await analyze(note());
    expect(detectVibratos(lead, take)).toHaveLength(0);
  });

  it('compares a take sung an octave under the singer', async () => {
    const lead = await analyze(
      note({ vibrato: { rate: 5.5, extentCents: 100, delay: 0.4 } }),
    );
    const take = await analyze(note({ frequency: 123.5 }));
    const [mark] = detectVibratos(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('add');
  });
});
