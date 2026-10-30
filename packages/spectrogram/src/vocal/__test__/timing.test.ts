import { describe, expect, it } from 'vitest';
import { detectTimings } from '../timing.js';
import {
  analyzeSynthetic,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

const syllableSeconds = 0.25;
const syllableStep = 0.3;

const phrase = (start: number, shift: number): ToneSpec[] =>
  Array.from({ length: 4 }, (_, index) => ({
    start: start + shift + index * syllableStep,
    duration: syllableSeconds,
    frequency: 220 + index * 20,
  }));

const song = async (shifts: number[]) =>
  analyzeSynthetic(
    synthesizeVoice(
      6,
      shifts.flatMap((shift, index) => phrase(0.5 + index * 1.8, shift)),
    ),
  );

describe('vocal timing', () => {
  it('asks to come in earlier where one phrase of the take lags', async () => {
    const lead = await song([0, 0, 0]);
    const take = await song([0.09, 0, 0]);
    const marks = detectTimings(lead, take);
    expect(marks).toHaveLength(3);
    expect(marks[0].status).toBe('differ');
    expect(marks[0].advice).toBe('earlier');
    expect(marks[0].take?.offsetMs).toBeGreaterThan(70);
    expect(marks[1].status).toBe('match');
    expect(marks[2].status).toBe('match');
  });

  it('takes a shift of the whole take for latency, not for timing', async () => {
    const lead = await song([0, 0, 0]);
    const take = await song([0.07, 0.07, 0.07]);
    const marks = detectTimings(lead, take);
    expect(marks.every((mark) => mark.status === 'match')).toBe(true);
    expect(marks[0].take?.overallMs).toBeGreaterThan(55);
  });
});
