import { type MasterPages, openMasterPages } from '@musetric/audio/decoder';
import { getMasterAudioRange } from '../audioRequest/audioRequest.worker.js';
import { stemPagesChannel } from './stemPages.cross.js';

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const serveStemPages = (): void => {
  const port = stemPagesChannel.inbound(self);
  let opened: MasterPages | undefined = undefined;
  const reads = new Map<number, AbortController>();

  port.bindHandlers({
    open: async (message) => {
      const { projectId, stem, sampleRate } = message;
      try {
        opened?.free();
        opened = undefined;
        const pages = await openMasterPages(async (from, to, signal) =>
          getMasterAudioRange({ projectId, type: stem, from, to, signal }),
        );
        if (pages.sampleRate !== sampleRate) {
          pages.free();
          throw new Error(
            `The ${stem} master is at ${String(pages.sampleRate)} Hz, the player at ${String(sampleRate)} Hz`,
          );
        }
        opened = pages;
        port.methods.opened({
          frameCount: pages.frameCount,
          channelCount: pages.channelCount,
          pageStarts: pages.pageStarts,
        });
      } catch (error) {
        port.methods.failed({ reason: describe(error) });
      }
    },
    read: async (message) => {
      const { id, index, mean } = message;
      const pages = opened;
      if (!pages) {
        port.methods.failed({ id, reason: 'No master is open' });
        return;
      }
      const controller = new AbortController();
      reads.set(id, controller);
      try {
        const page = await pages.read(index, mean, controller.signal);
        port.methods.page({
          id,
          index,
          startFrame: page.startFrame,
          frameCount: page.frameCount,
          samples: page.samples,
          ...(page.mean ? { mean: page.mean } : {}),
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          port.methods.failed({ id, reason: describe(error) });
        }
      } finally {
        reads.delete(id);
      }
    },
    cancel: (message) => {
      reads.get(message.id)?.abort();
    },
  });
};

serveStemPages();
