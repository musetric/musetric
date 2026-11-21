import { type MasterPages, openMasterPages } from '@musetric/audio/decoder';
import { getMasterAudioRange } from '../audioRequest/audioRequest.worker.js';
import { stemPagesChannel } from './stemPages.cross.js';

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const meanOf = (
  samples: Float32Array,
  channelCount: number,
  frameCount: number,
): Float32Array<ArrayBuffer> => {
  const mono = new Float32Array(frameCount);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const offset = channel * frameCount;
    for (let frame = 0; frame < frameCount; frame += 1) {
      mono[frame] += samples[offset + frame];
    }
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    mono[frame] /= channelCount;
  }
  return mono;
};

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
        const page = await pages.read(index);
        port.methods.page({
          id,
          index,
          startFrame: page.startFrame,
          frameCount: page.frameCount,
          samples: mono
            ? meanOf(page.samples, pages.channelCount, page.frameCount)
            : page.samples,
        });
      } catch (error) {
        port.methods.failed({ id, reason: describe(error) });
      }
    },
  });
};

serveStemPages();
