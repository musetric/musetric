import { type StemType } from '@musetric/audio/es';
import {
  type StemPageSamples,
  stemPagesChannel,
  type StemPagesInfo,
} from './stemPages.cross.js';
import stemPagesWorkerUrl from './stemPages.worker.ts?worker&url';

export type StemPageReader = {
  open: (projectId: number, sampleRate: number) => Promise<StemPagesInfo>;
  read: (
    index: number,
    mean: boolean,
    signal: AbortSignal,
  ) => Promise<StemPageSamples>;
};

type Pending<Value> = {
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
};

const createStemPageReader = (stem: StemType): StemPageReader => {
  const port = stemPagesChannel.outbound(
    new Worker(stemPagesWorkerUrl, { type: 'module' }),
  );
  let opening: Pending<StemPagesInfo> | undefined = undefined;
  const reads = new Map<number, Pending<StemPageSamples>>();
  let nextId = 0;

  port.bindHandlers({
    opened: (message) => {
      opening?.resolve(message);
      opening = undefined;
    },
    page: (message) => {
      reads.get(message.id)?.resolve(message);
      reads.delete(message.id);
    },
    failed: (message) => {
      const error = new Error(message.reason);
      if (message.id === undefined) {
        opening?.reject(error);
        opening = undefined;
        return;
      }
      reads.get(message.id)?.reject(error);
      reads.delete(message.id);
    },
  });

  return {
    open: async (projectId, sampleRate) =>
      new Promise<StemPagesInfo>((resolve, reject) => {
        opening?.reject(new Error(`The ${stem} master was opened again`));
        opening = { resolve, reject };
        port.methods.open({ projectId, stem, sampleRate });
      }),
    read: async (index, mean, signal) => {
      signal.throwIfAborted();
      return new Promise<StemPageSamples>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        reads.set(id, { resolve, reject });
        port.methods.read({ id, index, mean });
        signal.addEventListener(
          'abort',
          () => {
            if (reads.delete(id)) {
              port.methods.cancel({ id });
              reject(signal.reason);
            }
          },
          { once: true },
        );
      });
    },
  };
};

export type StemPageReaders = Record<StemType, StemPageReader>;

export const createStemPageReaders = (): StemPageReaders => ({
  lead: createStemPageReader('lead'),
  backing: createStemPageReader('backing'),
  instrumental: createStemPageReader('instrumental'),
});
