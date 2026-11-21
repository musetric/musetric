import init, { FlacPages } from '@musetric/dsp/decode';

const headerChunkBytes = 64 * 1024;

const ownBuffer = (samples: Float32Array): Float32Array<ArrayBuffer> =>
  samples.buffer instanceof ArrayBuffer
    ? new Float32Array(samples.buffer, samples.byteOffset, samples.length)
    : new Float32Array(samples);

export type FetchRange = (
  from: number,
  to: number | undefined,
) => Promise<Uint8Array>;

const readHeader = async (fetchRange: FetchRange): Promise<FlacPages> => {
  let prefix = new Uint8Array(0);
  for (;;) {
    const chunk = await fetchRange(
      prefix.length,
      prefix.length + headerChunkBytes,
    );
    const joined = new Uint8Array(prefix.length + chunk.length);
    joined.set(prefix);
    joined.set(chunk, prefix.length);
    prefix = joined;
    const pages = FlacPages.read(prefix);
    if (pages) {
      return pages;
    }
    if (chunk.length < headerChunkBytes) {
      throw new Error('The master ended before its header');
    }
  }
};

export type MasterPage = {
  index: number;
  startFrame: number;
  frameCount: number;
  samples: Float32Array<ArrayBuffer>;
};

export type MasterPages = {
  frameCount: number;
  sampleRate: number;
  channelCount: number;
  pageStarts: number[];
  read: (index: number, mean: boolean) => Promise<MasterPage>;
  free: () => void;
};

export const openMasterPages = async (
  fetchRange: FetchRange,
): Promise<MasterPages> => {
  await init();
  const pages = await readHeader(fetchRange);
  const channelCount = pages.channels;
  const pageStarts = Array.from(
    { length: pages.pageCount },
    (_, index) => pages.pageStart(index) ?? 0,
  );
  return {
    frameCount: pages.frameCount,
    sampleRate: pages.sampleRate,
    channelCount,
    pageStarts,
    read: async (index, mean) => {
      const from = pages.byteStart(index);
      const frameCount = pages.pageFrames(index);
      if (from === undefined || frameCount === undefined) {
        throw new Error(`The master has no page ${String(index)}`);
      }
      const bytes = await fetchRange(from, pages.byteEnd(index));
      return {
        index,
        startFrame: pageStarts[index],
        frameCount,
        samples: ownBuffer(
          mean ? pages.decodeMean(index, bytes) : pages.decode(index, bytes),
        ),
      };
    },
    free: () => {
      pages.free();
    },
  };
};
