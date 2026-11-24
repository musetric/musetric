import { describe, expect, it, onTestFinished } from 'vitest';
import { isPlaying } from '../../state.js';
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

  it('keeps a take playing when the ack of an earlier seek comes after it began', async () => {
    const seam = await open();
    seam.player.seek(rate, 'player');
    const recording = seam.player.record(1);
    await flush();
    seam.microphone.open();
    await seam.run(quantaOfSeconds(0.5));
    await recording;
    await seam.run(quantaOfSeconds(0.5));
    expect(seam.store.get().session).toBe('taking');
    expect(isPlaying(seam.store.get())).toBe(true);
  });

  it('plays when Play is pressed while a Stop waits for its ack', async () => {
    const seam = await open();
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.2));
    const stopping = seam.player.stop();
    expect(seam.store.get().session).toBe('stopping');
    const playing = seam.player.play();
    await Promise.all([stopping, playing]);
    expect(seam.store.get().session).toBe('playing');
  });

  it('starts a take when Record is pressed while Play starts', async () => {
    const seam = await open();
    const playing = seam.player.play();
    expect(seam.store.get().session).toBe('starting');
    const recording = seam.player.record(1);
    await playing;
    await flush();
    expect(seam.store.get().take).toBe('arming');
    seam.microphone.open();
    await seam.run(quantaOfSeconds(0.5));
    await recording;
    expect(seam.store.get().session).toBe('taking');
    expect(seam.store.get().take).toBe('recording');
  });

  it('cancels a take that arms while playing when Stop is pressed', async () => {
    const seam = await open();
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.2));
    const recording = seam.player.record(1);
    await flush();
    expect(seam.store.get().take).toBe('arming');
    const stopping = seam.player.stop();
    seam.microphone.open();
    await Promise.all([stopping, recording]);
    expect(seam.store.get().session).toBe('idle');
    expect(seam.store.get().take).toBe('none');
    expect(seam.host).toEqual([]);
  });

  it('drops a Play that waits when Stop is pressed after it', async () => {
    const seam = await open();
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.2));
    const plays = seam.toWorklet.filter((type) => type === 'play').length;
    const stopping = seam.player.stop();
    const playing = seam.player.play();
    const stoppingAgain = seam.player.stop();
    await Promise.all([stopping, playing, stoppingAgain]);
    expect(isPlaying(seam.store.get())).toBe(false);
    expect(seam.toWorklet.filter((type) => type === 'play')).toHaveLength(
      plays,
    );
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
