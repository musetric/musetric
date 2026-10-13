import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import axios from 'axios';
import {
  type LiveTakeChunk,
  type LiveTakeStart,
} from '../player/protocol.cross.js';
import { recordingStreamChannel } from '../player/recordingStream.cross.js';
import { type AudioDecode } from './audioDecode.worker.js';
import { type SettledLoopTry } from './protocol.cross.js';
import {
  createRecordingStream,
  type RecordingStream,
} from './recordingStream.worker.js';

type LoopTryDraft = LiveTakeStart & {
  startFrame: number;
  samples: Float32Array<ArrayBuffer>;
  frameCount: number;
};

export type LoopTryDraftStart = Omit<LiveTakeStart, 'takeId'> & {
  port: MessagePort;
};

export type LoopTryTarget = {
  projectId: number;
  recordingId: number;
  tryId: string;
  sampleRate: number;
  frameCount: number;
};

export type LoopTries = {
  openDraft: (start: LoopTryDraftStart) => RecordingStream;
  settle: (keep: boolean) => SettledLoopTry | undefined;
  select: (tryId: string | undefined) => void;
  remove: (tryId: string) => void;
  discard: () => void;
  insert: (target: LoopTryTarget) => Promise<boolean>;
  clear: () => void;
};

export type CreateLoopTriesOptions = {
  audioDecode: AudioDecode;
};

export const createLoopTries = (options: CreateLoopTriesOptions): LoopTries => {
  const { audioDecode } = options;
  const kept = new Map<string, LoopTryDraft>();
  let pending: LoopTryDraft | undefined = undefined;
  let liveTryId: string | undefined = undefined;

  const hide = () => {
    if (liveTryId !== undefined) {
      audioDecode.clearLiveTake(liveTryId);
      liveTryId = undefined;
    }
  };

  const show = (draft: LoopTryDraft) => {
    audioDecode.beginLiveTake({
      takeId: draft.takeId,
      tempo: draft.tempo,
      transpose: draft.transpose,
      octave: draft.octave,
    });
    audioDecode.patchLiveTake({
      startFrame: draft.startFrame,
      offset: 0,
      samples: draft.samples.slice(0, draft.frameCount),
    });
    liveTryId = draft.takeId;
  };

  const append = (chunk: LiveTakeChunk) => {
    const draft = pending;
    if (!draft) {
      return;
    }
    if (draft.frameCount === 0) {
      draft.startFrame = chunk.startFrame;
    }
    const end = chunk.offset + chunk.samples.length;
    if (end > draft.samples.length) {
      const grown = new Float32Array(Math.max(end, draft.samples.length * 2));
      grown.set(draft.samples.subarray(0, draft.frameCount));
      draft.samples = grown;
    }
    draft.samples.set(chunk.samples, chunk.offset);
    draft.frameCount = Math.max(draft.frameCount, end);
    audioDecode.patchLiveTake(chunk);
  };

  return {
    openDraft: (start) => {
      hide();
      const take: LiveTakeStart = {
        takeId: `try-${crypto.randomUUID()}`,
        tempo: start.tempo,
        transpose: start.transpose,
        octave: start.octave,
      };
      pending = {
        ...take,
        startFrame: 0,
        samples: new Float32Array(0),
        frameCount: 0,
      };
      audioDecode.beginLiveTake(take);
      liveTryId = take.takeId;
      return createRecordingStream({
        port: recordingStreamChannel.outbound(start.port),
        onChunk: append,
      });
    },
    settle: (keep) => {
      const draft = pending;
      pending = undefined;
      if (!draft || !keep || draft.frameCount === 0) {
        return undefined;
      }
      kept.set(draft.takeId, draft);
      return {
        id: draft.takeId,
        startFrame: draft.startFrame,
        frameCount: draft.frameCount,
      };
    },
    select: (tryId) => {
      if (tryId === liveTryId) {
        return;
      }
      hide();
      const draft = tryId === undefined ? undefined : kept.get(tryId);
      if (draft) {
        show(draft);
      }
    },
    remove: (tryId) => {
      if (tryId === liveTryId) {
        hide();
      }
      kept.delete(tryId);
    },
    discard: () => {
      hide();
      kept.clear();
    },
    insert: async (target) => {
      const { projectId, recordingId, tryId } = target;
      const draft = kept.get(tryId);
      if (!draft) {
        return false;
      }
      try {
        await requestWithAxios(axios, api.recording.insertTake.base, {
          params: { projectId, recordingId },
          data: {
            startFrame: draft.startFrame,
            tempo: draft.tempo,
            transpose: draft.transpose,
            octave: draft.octave,
            sampleRate: target.sampleRate,
            frameCount: target.frameCount,
            samples: new File(
              [draft.samples.slice(0, draft.frameCount)],
              'take.f32',
              { type: 'application/octet-stream' },
            ),
          },
        });
      } catch (error) {
        console.error('Failed to insert the loop try', error);
        return false;
      }
      kept.delete(tryId);
      if (liveTryId === tryId) {
        liveTryId = undefined;
        await audioDecode.reloadRecording(tryId);
      }
      return true;
    },
    clear: () => {
      kept.clear();
      pending = undefined;
      liveTryId = undefined;
    },
  };
};
