import { describe, expect, it, onTestFinished } from 'vitest';
import { rate } from './player.fixtures.js';
import { createSeam, type CreateSeamOptions, flush } from './seam.fixtures.js';

const open = async (options?: CreateSeamOptions) => {
  const seam = await createSeam(options);
  onTestFinished(() => {
    seam.close();
  });
  return seam;
};

const quantaOfSeconds = (seconds: number) => Math.round((seconds * rate) / 128);

describe('the commands of the player', () => {
  it('plays at a tempo set before the worklet booted', async () => {
    const seam = await open({
      before: (store) => {
        store.update((state) => {
          state.tempoRatio = 0.5;
        });
      },
    });
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.5));
    await seam.frame();
    const from = seam.position.read();
    await seam.run(quantaOfSeconds(1));
    await seam.frame();
    const moved = seam.position.read() - from;
    expect(moved).toBeGreaterThan(0.4 * rate);
    expect(moved).toBeLessThan(0.6 * rate);
  });

  it('sends a message for each command at once, in the order of the commands', async () => {
    const seam = await open();
    const before = seam.toWorklet.length;
    seam.player.setTempoRatio(0.8);
    seam.player.setVoiceOctave(1);
    seam.player.setTrackVolume('lead', 0.5);
    seam.player.setTrackVolume('recording', 0.5);
    seam.player.setMetronomeEnabled(true);
    seam.player.setTransposeSemitones(2);
    await flush();
    expect(seam.toWorklet.slice(before)).toEqual([
      'setTempoRatio',
      'setVoiceOctave',
      'setTrackVolume',
      'setRecordingVolume',
      'setMetronome',
      'setTransposeSemitones',
    ]);
  });
});
