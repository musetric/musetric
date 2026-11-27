import { type MasterPages, openMasterPages } from '@musetric/audio/decoder';
import { getMasterAudioRange } from '../audioRequest/audioRequest.worker.js';
import { stemPagesChannel } from './stemPages.cross.js';

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type QueuedRead = {
  index: number;
  run: () => Promise<void>;
};

const serveStemPages = (): void => {
  const port = stemPagesChannel.inbound(self);
  let opened: MasterPages | undefined = undefined;
  const reads = new Map<number, AbortController>();
  const queue: QueuedRead[] = [];
  let wanted: number[] = [];
  let reading: Promise<void> = Promise.resolve();

  const rank = (read: QueuedRead) => {
    const at = wanted.indexOf(read.index);
    return at === -1 ? wanted.length : at;
  };

  const takeNext = () => {
    let next = 0;
    for (let at = 1; at < queue.length; at += 1) {
      if (rank(queue[at]) < rank(queue[next])) {
        next = at;
      }
    }
    return queue.splice(next, 1).at(0);
  };

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
    read: (message) => {
      const { id, index, parts } = message;
      const pages = opened;
      if (!pages) {
        port.methods.failed({ id, reason: 'No master is open' });
        return;
      }
      const controller = new AbortController();
      reads.set(id, controller);
      const run = async () => {
        try {
          if (controller.signal.aborted) {
            return;
          }
          const page = await pages.read(index, parts, controller.signal);
          port.methods.page({
            id,
            index,
            startFrame: page.startFrame,
            frameCount: page.frameCount,
            ...(page.samples ? { samples: page.samples } : {}),
            ...(page.mean ? { mean: page.mean } : {}),
          });
        } catch (error) {
          if (!controller.signal.aborted) {
            port.methods.failed({ id, reason: describe(error) });
          }
        } finally {
          reads.delete(id);
        }
      };
      queue.push({ index, run });
      reading = reading.then(async () => takeNext()?.run());
    },
    setWanted: (message) => {
      wanted = message.indices;
    },
    cancel: (message) => {
      reads.get(message.id)?.abort();
    },
  });
};

serveStemPages();
