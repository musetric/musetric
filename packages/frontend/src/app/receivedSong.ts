import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { routes } from './router/routes.js';

const songSchema = z.discriminatedUnion('status', [
  z.object({ id: z.string(), status: z.literal('copying') }),
  z.object({ id: z.string(), status: z.literal('failed') }),
  z.object({
    id: z.string(),
    status: z.literal('ready'),
    name: z.string(),
    type: z.string(),
    size: z.number(),
  }),
]);

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('share'), share: songSchema.nullable() }),
  z.object({ type: z.literal('gone') }),
]);

type ReceivedSongBridge = {
  postMessage: (message: string) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
};

type ReceivedSongWindow = Window & {
  MusetricReceivedSong?: ReceivedSongBridge;
};

const findBridge = (): ReceivedSongBridge | undefined => {
  const target: ReceivedSongWindow = window;
  return target.MusetricReceivedSong;
};

export type ReceivedSong = z.infer<typeof songSchema>;

type ChunkRequest = {
  resolve: (chunk: Uint8Array<ArrayBuffer>) => void;
  reject: (error: Error) => void;
};

const createReceivedSong = () => {
  const bridge = findBridge();
  let received: ReceivedSong | undefined = undefined;
  const listeners = new Set<() => void>();
  const chunkRequests: ChunkRequest[] = [];
  const finished = new Set<string>();

  const present = () => {
    if (received && routes.home.match()) {
      routes.projectsCreate.navigate();
    }
  };

  const update = (next: ReceivedSong | undefined) => {
    received = next;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    get: () => received,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    present,
    finish: (id: string) => {
      finished.add(id);
      if (received?.id === id) {
        update(undefined);
      }
      bridge?.postMessage(JSON.stringify({ type: 'finish', id }));
    },
    read: async (
      song: Extract<ReceivedSong, { status: 'ready' }>,
      signal: AbortSignal,
    ): Promise<File> => {
      if (!bridge) {
        throw new Error('Received songs are not supported here');
      }
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let offset = 0;
      while (offset < song.size) {
        signal.throwIfAborted();
        const chunk = await new Promise<Uint8Array<ArrayBuffer>>(
          (resolve, reject) => {
            chunkRequests.push({ resolve, reject });
            bridge.postMessage(
              JSON.stringify({ type: 'read', id: song.id, offset }),
            );
          },
        );
        if (chunk.byteLength === 0) {
          throw new Error('Received song ended early');
        }
        parts.push(chunk);
        offset += chunk.byteLength;
      }
      return new File(parts, song.name, { type: song.type });
    },
    listen: () => {
      if (!bridge) {
        return;
      }
      bridge.addEventListener('message', (event) => {
        const { data } = event;
        if (data instanceof ArrayBuffer) {
          chunkRequests.shift()?.resolve(new Uint8Array(data));
          return;
        }
        if (typeof data !== 'string') {
          return;
        }
        const message = messageSchema.parse(JSON.parse(data));
        if (message.type === 'gone') {
          chunkRequests.shift()?.reject(new Error('Received song is gone'));
          return;
        }
        const { share } = message;
        update(share && !finished.has(share.id) ? share : undefined);
        present();
      });
      bridge.postMessage(JSON.stringify({ type: 'subscribe' }));
    },
  };
};

export const receivedSong = createReceivedSong();

export const useReceivedSong = (): ReceivedSong | undefined =>
  useSyncExternalStore(receivedSong.subscribe, receivedSong.get);
