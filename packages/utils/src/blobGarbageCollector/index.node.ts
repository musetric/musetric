import { type BlobStorage } from '../blobStorage/index.node.js';
import { createCallLatest } from '../callLatest.js';
import { createScheduler, type Scheduler } from '../scheduler.cross.js';
import { collectGarbage } from './common.node.js';

export type CreateBlobGarbageCollectorOptions = {
  blobStorage: BlobStorage;
  gcIntervalMs: number;
  blobRetentionMs: number;
  getReferencedBlobIds: () => Promise<string[]>;
};
export const createBlobGarbageCollector = (
  options: CreateBlobGarbageCollectorOptions,
): Scheduler => {
  const { blobStorage, gcIntervalMs, blobRetentionMs, getReferencedBlobIds } =
    options;

  const ref = createScheduler(
    createCallLatest(async () => {
      const referencedBlobIds = await getReferencedBlobIds();
      await collectGarbage(blobStorage, blobRetentionMs, referencedBlobIds);
    }),
    gcIntervalMs,
  );

  return ref;
};
