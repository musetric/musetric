import { type MasterPage, type MasterPages } from '@musetric/audio/decoder';
import { describe, expect, it, vi } from 'vitest';
import { stemPagesChannel } from '../stemPages.cross.js';

type PendingRead = {
  index: number;
  signal: AbortSignal;
  finish: () => void;
};

const pending: PendingRead[] = [];

vi.mock('../../audioRequest/audioRequest.worker.js', () => ({
  getMasterAudioRange: async () => Promise.resolve(new Uint8Array(0)),
}));

vi.mock('@musetric/audio/decoder', () => ({
  openMasterPages: async (): Promise<MasterPages> =>
    Promise.resolve({
      frameCount: 8,
      sampleRate: 48000,
      channelCount: 2,
      pageStarts: [0, 4],
      read: async (index, _mean, signal) =>
        new Promise<MasterPage>((resolve, reject) => {
          pending.push({
            index,
            signal,
            finish: () => {
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              resolve({
                index,
                startFrame: index * 4,
                frameCount: 4,
                samples: new Float32Array(8),
              });
            },
          });
        }),
      free: () => undefined,
    }),
}));

const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
};

describe('stem pages', () => {
  it('reads one page at a time and drops a read it is told to cancel', async () => {
    const channel = new MessageChannel();
    vi.stubGlobal('self', channel.port1);
    await import('../stemPages.worker.js');
    const client = stemPagesChannel.outbound(channel.port2);
    const pages: number[] = [];
    const failed: (number | undefined)[] = [];
    client.bindHandlers({
      opened: () => undefined,
      page: (message) => {
        pages.push(message.id);
      },
      failed: (message) => {
        failed.push(message.id);
      },
    });
    const started = () => pending.map((read) => read.index);

    client.methods.open({ projectId: 1, stem: 'lead', sampleRate: 48000 });
    await settle();
    client.methods.read({ id: 1, index: 0, mean: false });
    client.methods.read({ id: 2, index: 1, mean: false });
    await settle();
    expect(started()).toEqual([0]);

    client.methods.cancel({ id: 2 });
    await settle();
    pending[0].finish();
    await settle();
    expect(started()).toEqual([0]);

    client.methods.read({ id: 3, index: 1, mean: false });
    client.methods.read({ id: 4, index: 0, mean: false });
    await settle();
    expect(started()).toEqual([0, 1]);
    client.methods.cancel({ id: 3 });
    await settle();
    expect(pending[1].signal.aborted).toBe(true);
    expect(started()).toEqual([0, 1]);
    pending[1].finish();
    await settle();
    expect(started()).toEqual([0, 1, 0]);
    pending[2].finish();
    await settle();

    expect(pages).toEqual([1, 4]);
    expect(failed).toEqual([]);
    channel.port1.close();
    channel.port2.close();
    vi.unstubAllGlobals();
  });
});
