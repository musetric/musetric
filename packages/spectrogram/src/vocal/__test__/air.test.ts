import { describe, expect, it } from 'vitest';
import { detectAirs } from '../air.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const harmonics = Array.from(
  { length: 24 },
  (_, harmonic) => 1 / (harmonic + 1),
);

const song = async (breaths: number[]) =>
  analyzeSynthetic(
    synthesizeVoice(
      7,
      breaths.map((breath, index): ToneSpec => ({
        start: 0.5 + index * 1.2,
        duration: 0.8,
        frequency: 240,
        breath,
        harmonics,
      })),
    ),
  );

describe('vocal air', () => {
  it('asks for the air the singer adds on one note', async () => {
    const lead = await song([0, 0, 0.3, 0, 0]);
    const take = await song([0, 0, 0, 0, 0]);
    const marks = detectAirs(lead, take);
    const [mark] = marks;
    expect(marks).toHaveLength(1);
    expect(mark.status).toBe('differ');
    expect(mark.advice).toBe('moreAir');
    expect(mark.start).toBeGreaterThan(2.8);
    expect(mark.lead.relativeDb).toBeLessThan(-3);
  });

  it('asks for a clear note where the singer drops the air', async () => {
    const lead = await song([0.3, 0.3, 0, 0.3, 0.3]);
    const take = await song([0.3, 0.3, 0.3, 0.3, 0.3]);
    const [mark] = detectAirs(lead, take);
    expect(mark.advice).toBe('lessAir');
    expect(mark.lead.relativeDb).toBeGreaterThan(3);
  });

  it('matches a take that adds the air at the same place', async () => {
    const lead = await song([0, 0, 0.3, 0, 0]);
    const take = await song([0, 0, 0.3, 0, 0]);
    const [mark] = detectAirs(lead, take);
    expect(mark.status).toBe('match');
  });
});
