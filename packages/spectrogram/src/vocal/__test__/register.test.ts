import { describe, expect, it } from 'vitest';
import { detectRegisters } from '../register.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const light = [1, 0.2, 0.08, 0.04, 0.02, 0.01];
const full = [0.6, 1, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2];

const note = (harmonics: number[], frequency = 349): ToneSpec => ({
  start: 0.5,
  duration: 0.8,
  frequency,
  harmonics,
});

const analyze = async (tone: ToneSpec) =>
  analyzeSynthetic(synthesizeVoice(1.8, [tone]));

describe('vocal register', () => {
  it('asks for a fuller voice where the singer belts and the take flips', async () => {
    const lead = await analyze(note(full));
    const take = await analyze(note(light));
    const [mark] = detectRegisters(lead, take);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('fuller');
    expect(mark.lead.firstOverSecondDb).toBeLessThan(0);
    expect(mark.take?.firstOverSecondDb).toBeGreaterThan(12);
  });

  it('asks for a lighter voice where the singer goes to head voice', async () => {
    const lead = await analyze(note(light));
    const take = await analyze(note(full));
    const [mark] = detectRegisters(lead, take);
    expect(mark.advice).toBe('lighter');
  });

  it('names the belt of the singer on a high note before a take', async () => {
    const lead = await analyze(note(full));
    const [mark] = detectRegisters(lead, undefined);
    expect(mark.status).toBe('trait');
    expect(mark.advice).toBe('fuller');
  });

  it('skips low notes where the stem and the microphone bend the first harmonic', async () => {
    const lead = await analyze(note(full, 150));
    const take = await analyze(note(light, 150));
    expect(detectRegisters(lead, take)).toHaveLength(0);
  });

  it('leaves a take an octave under the singer to its own register', async () => {
    const lead = await analyze(note(full, 440));
    const take = await analyze(note(light, 220));
    expect(detectRegisters(lead, take)[0]?.status).not.toBe('differ');
  });
});
