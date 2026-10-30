import { describe, expect, it } from 'vitest';
import { detectTransitions } from '../transition.js';
import {
  analyzeSynthetic,
  type PitchStep,
  synthesizeVoice,
} from './voiceFixtures.js';

const analyze = async (step: PitchStep) =>
  analyzeSynthetic(
    synthesizeVoice(2.6, [
      { start: 0.5, duration: 1.4, frequency: 220, steps: [step] },
    ]),
  );

const jump: PitchStep = { at: 0.6, cents: 500, seconds: 0.01 };
const glide: PitchStep = { at: 0.6, cents: 500, seconds: 0.2 };

describe('vocal transitions', () => {
  it('asks to slide into the next note like the singer', async () => {
    const lead = await analyze(glide);
    const take = await analyze(jump);
    const [mark] = detectTransitions(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('slide');
    expect(mark.lead.slideMs).toBeGreaterThan(120);
    expect(mark.take?.slideMs).toBeLessThan(40);
  });

  it('asks to step cleanly where the singer jumps', async () => {
    const lead = await analyze(jump);
    const take = await analyze(glide);
    const [mark] = detectTransitions(lead, take);
    expect(mark.advice).toBe('step');
  });

  it('asks for the overshoot of the singer', async () => {
    const lead = await analyze({ ...jump, overshootCents: 80 });
    const take = await analyze(jump);
    const [mark] = detectTransitions(lead, take);
    expect(mark.advice).toBe('overshoot');
    expect(mark.lead.overshootCents).toBeGreaterThan(50);
  });

  it('names the slide of the singer before a take exists', async () => {
    const lead = await analyze(glide);
    const [mark] = detectTransitions(lead, undefined);
    expect(mark.status).toBe('trait');
    expect(mark.advice).toBe('slide');
    expect(mark.lead.intervalCents).toBeCloseTo(500, -1);
  });
});
