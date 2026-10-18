import { describe, expect, it } from 'vitest';
import { defaultSpectrogramConfig } from '../../defaultConfig.cross.js';
import { createPitchSchedule, type PitchPlan } from '../schedule.es.js';
import { createPitchSettings } from '../settings.es.js';

const settings = createPitchSettings(defaultSpectrogramConfig.sampleRate);
const { hop, support } = settings;
const availableSamples = 200 * hop + 37;

const planLiveTake = (truncated: boolean): PitchPlan =>
  createPitchSchedule(settings).plan({
    trackFrames: 400,
    truncated,
    availableSamples,
    visibleFirst: 150,
    visibleLast: 210,
    invalidations: [],
    reset: true,
    position: (songFrame) => songFrame,
  });

const windowEnds = (plan: PitchPlan) =>
  plan.slots
    .filter((slot) => slot.observe)
    .map((slot) => {
      const span = plan.spans.find(
        (entry) =>
          slot.spanOffset >= entry.spanOffset &&
          slot.spanOffset < entry.spanOffset + entry.length,
      );
      if (!span) {
        throw new Error(`frame ${slot.frame} has no span`);
      }
      const center =
        span.sampleStart + support + slot.spanOffset - span.spanOffset;
      return { frame: slot.frame, center, end: center + support };
    });

describe('pitch schedule', () => {
  it('ends the windows of a live take at the recorded samples', () => {
    const windows = windowEnds(planLiveTake(true));
    const filled = windows.filter(
      (entry) => entry.frame * hop + support <= availableSamples,
    );
    const open = windows.filter(
      (entry) => entry.frame * hop + support > availableSamples,
    );
    expect(filled.length).toBeGreaterThan(0);
    expect(open.length).toBeGreaterThan(0);
    for (const entry of filled) {
      expect(entry.center).toBe(entry.frame * hop);
    }
    for (const entry of open) {
      expect(entry.end).toBe(availableSamples);
    }
  });

  it('keeps every window centred on its frame for a finished track', () => {
    for (const entry of windowEnds(planLiveTake(false))) {
      expect(entry.center).toBe(entry.frame * hop);
    }
  });

  it('chains a repeated window to the window before it', () => {
    const { slots } = planLiveTake(true);
    for (const [index, slot] of slots.entries()) {
      const previous = slots[slot.predecessor];
      if (index > 0 && slot.predecessor >= 0) {
        expect(previous.spanOffset).not.toBe(slot.spanOffset);
      }
    }
  });
});
