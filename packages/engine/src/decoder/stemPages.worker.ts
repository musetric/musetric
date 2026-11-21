import { type MasterPages, openMasterPages } from '@musetric/audio/decoder';
import { getMasterAudioRange } from '../audioRequest/audioRequest.worker.js';
import { stemPagesChannel } from './stemPages.cross.js';

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const serveStemPages = (): void => {
  const port = stemPagesChannel.inbound(self);
  let opened: MasterPages | undefined = undefined;

  port.bindHandlers({
    open: async (message) => {
      const { projectId, stem, sampleRate } = message;
      try {
        opened?.free();
        opened = undefined;
        const pages = await openMasterPages(async (from, to) =>
          getMasterAudioRange(projectId, stem, from, to),
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
      const { id, index, mono } = message;
      const pages = opened;
      if (!pages) {
        port.methods.failed({ id, reason: 'No master is open' });
        return;
      }
      try {
        const page = await pages.read(index, mono);
        port.methods.page({
          id,
          index,
          startFrame: page.startFrame,
          frameCount: page.frameCount,
          samples: page.samples,
        });
      } catch (error) {
        port.methods.failed({ id, reason: describe(error) });
      }
    },
  });
};

serveStemPages();
