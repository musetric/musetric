import { z } from 'zod';
import { routes } from './router/routes.js';

type ReceivedSongBridge = {
  waiting: () => boolean;
  take: () => unknown;
  read: (id: string, offset: number, length: number) => unknown;
  release: (id: string) => void;
  giveBack: (id: string) => void;
  dismiss: () => void;
  applying: () => boolean;
};

type ReceivedSongWindow = Window & {
  MusetricReceivedSong?: ReceivedSongBridge;
};

const findBridge = (): ReceivedSongBridge | undefined => {
  const target: ReceivedSongWindow = window;
  return target.MusetricReceivedSong;
};

const receivedEventName = 'musetric:received-song';
const chunkBytes = 1024 * 1024;
const applyingEventName = 'musetric:received-song-applying';

const announceApplying = () => {
  window.dispatchEvent(new Event(applyingEventName));
};

const yieldToPage = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const songSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
});

const takenSchema = z.union([
  z.object({ id: z.string(), failed: z.literal(true) }),
  songSchema,
]);

const readFile = async (
  from: ReceivedSongBridge,
  song: z.infer<typeof songSchema>,
  signal: AbortSignal,
): Promise<File> => {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < song.size; offset += chunkBytes) {
    await yieldToPage();
    signal.throwIfAborted();
    const chunk = from.read(song.id, offset, chunkBytes);
    if (typeof chunk !== 'string') {
      throw new Error('Received song is gone');
    }
    const text = atob(chunk);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      bytes[index] = text.charCodeAt(index);
    }
    parts.push(bytes);
  }
  return new File(parts, song.name, { type: song.type });
};

export const isReceivedSongWaiting = (): boolean =>
  findBridge()?.waiting() ?? false;

export type ReceivedSong = { file: File } | { failed: true };

const readSong = async (
  from: ReceivedSongBridge,
  song: z.infer<typeof songSchema>,
  signal: AbortSignal,
): Promise<ReceivedSong> => {
  try {
    return { file: await readFile(from, song, signal) };
  } catch {
    return { failed: true };
  }
};

export const isReceivedSongApplying = (): boolean =>
  findBridge()?.applying() ?? false;

export const subscribeReceivedSongApplying = (
  listener: () => void,
): (() => void) => {
  window.addEventListener(applyingEventName, listener);
  return () => {
    window.removeEventListener(applyingEventName, listener);
  };
};

export type TakenSong = {
  received: Promise<ReceivedSong>;
  release: () => void;
  giveBack: () => void;
};

export const takeReceivedSong = (
  signal: AbortSignal,
): TakenSong | undefined => {
  const bridge = findBridge();
  if (!bridge) {
    return undefined;
  }
  const json = bridge.take();
  if (typeof json !== 'string') {
    return undefined;
  }
  const parsed = takenSchema.safeParse(JSON.parse(json));
  if (!parsed.success) {
    return {
      received: Promise.resolve({ failed: true }),
      release: () => undefined,
      giveBack: () => undefined,
    };
  }
  const taken = parsed.data;
  announceApplying();
  const release = () => {
    bridge.release(taken.id);
    announceApplying();
  };
  const giveBack = () => {
    bridge.giveBack(taken.id);
    announceApplying();
  };
  if ('failed' in taken) {
    return { received: Promise.resolve({ failed: true }), release, giveBack };
  }
  return { received: readSong(bridge, taken, signal), release, giveBack };
};

export const dismissReceivedSong = (): void => {
  findBridge()?.dismiss();
};

export const subscribeReceivedSongs = (listener: () => void): (() => void) => {
  window.addEventListener(receivedEventName, listener);
  return () => {
    window.removeEventListener(receivedEventName, listener);
  };
};

export const presentReceivedSong = (): void => {
  if (!isReceivedSongWaiting()) {
    return;
  }
  if (routes.projectsCreate.match() || routes.project.match()) {
    return;
  }
  routes.projectsCreate.navigate();
};

export const receiveSongsFromSystem = (): void => {
  if (!findBridge()) {
    return;
  }
  window.addEventListener(receivedEventName, presentReceivedSong);
};
