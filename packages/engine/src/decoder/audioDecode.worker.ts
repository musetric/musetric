import { createAudioDecoder } from '@musetric/audio/decoder';
import {
  type LiveTakeChunk,
  type LiveTakeStart,
  type playerDataChannel,
  type PlayerRecordingPiece,
  type PlayerWindow,
} from '../player/protocol.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { createPageReads, type PageReads } from './pageReads.worker.js';
import {
  copyPieces,
  createRecordingAssembly,
  type RecordingAssembly,
} from './recordingAssembly.worker.js';
import {
  createStemPageReaders,
  type StemPageReaders,
} from './stemPageReaders.worker.js';

export type CreateAudioDecodeOptions = {
  playerPort: ReturnType<typeof playerDataChannel.outbound<MessagePort>>;
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
};

export type AudioDecode = {
  mount: (message: { projectId: number; sampleRate: number }) => Promise<{
    frameCount: number;
  }>;
  setActiveRecording: (recordingId: number | undefined) => void;
  beginLiveTake: (take: LiveTakeStart) => void;
  patchLiveTake: (chunk: LiveTakeChunk) => void;
  clearLiveTake: (takeId: string) => void;
  reloadRecording: (finishedTakeId?: string) => Promise<void>;
  requestTarget: (window: PlayerWindow) => void;
  unmount: () => void;
};

type MountedAudio = {
  projectId: number;
  sampleRate: number;
  frameCount: number;
  recordingId: number | undefined;
  pieces: PlayerRecordingPiece[];
};

type Reload = {
  finishedTakeId?: string;
  switched?: boolean;
};

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { playerPort, spectrogramPort } = options;
  const decoder = createAudioDecoder();
  let readers: StemPageReaders | undefined = undefined;
  let pageReads: PageReads | undefined = undefined;
  let mounted: MountedAudio | undefined = undefined;
  let assembly: RecordingAssembly | undefined = undefined;
  let activeRecordingId: number | undefined = undefined;
  let reloading: Promise<void> = Promise.resolve();
  let reloadOnMount: Reload | undefined = undefined;

  const getAssembly = (sampleRate: number): RecordingAssembly => {
    assembly ??= createRecordingAssembly(sampleRate, decoder);
    return assembly;
  };

  const loadPieces = async (
    current: Pick<MountedAudio, 'projectId' | 'sampleRate'>,
    recordingId: number | undefined,
  ): Promise<PlayerRecordingPiece[]> => {
    if (recordingId === undefined) {
      return [];
    }
    return await getAssembly(current.sampleRate).load(
      current.projectId,
      recordingId,
    );
  };

  const reloadPieces = async (reload: Reload): Promise<void> => {
    const current = mounted;
    if (!current) {
      reloadOnMount = { finishedTakeId: reload.finishedTakeId };
      return;
    }
    const recordingId = activeRecordingId;
    if (reload.switched && current.recordingId === recordingId) {
      return;
    }
    const pieces = await loadPieces(current, recordingId);
    if (mounted !== current || activeRecordingId !== recordingId) {
      return;
    }
    const switched =
      Boolean(reload.switched) || current.recordingId !== recordingId;
    current.recordingId = recordingId;
    current.pieces = pieces;
    playerPort.methods.setRecordingPieces({
      pieces: copyPieces(pieces),
      finishedTakeId: reload.finishedTakeId,
      switched,
    });
    spectrogramPort.methods.setRecordingPieces({
      pieces: copyPieces(pieces),
      finishedTakeId: reload.finishedTakeId,
      switched,
    });
  };

  const queueReload = async (reload: Reload): Promise<void> => {
    const next = reloading
      .catch(() => undefined)
      .then(async () => reloadPieces(reload));
    reloading = next;
    await next;
  };

  playerPort.bindHandlers({
    requestWindow: (message) => {
      pageReads?.requestWindow(message);
    },
  });

  spectrogramPort.bindHandlers({
    requestLeadPages: (message) => {
      pageReads?.requestLeadPages(message.indices);
    },
  });

  return {
    mount: async (message) => {
      const { projectId, sampleRate } = message;
      const recordingId = activeRecordingId;
      readers ??= createStemPageReaders();
      const current = readers;
      pageReads?.close();
      pageReads = undefined;
      const [[lead, backing, instrumental], pieces] = await Promise.all([
        Promise.all([
          current.lead.open(projectId, sampleRate),
          current.backing.open(projectId, sampleRate),
          current.instrumental.open(projectId, sampleRate),
        ]),
        loadPieces({ projectId, sampleRate }, recordingId),
      ]);
      const frameCount = Math.max(
        lead.frameCount,
        backing.frameCount,
        instrumental.frameCount,
      );
      const layouts = {
        lead: { frameCount: lead.frameCount, pageStarts: lead.pageStarts },
        backing: {
          frameCount: backing.frameCount,
          pageStarts: backing.pageStarts,
        },
        instrumental: {
          frameCount: instrumental.frameCount,
          pageStarts: instrumental.pageStarts,
        },
      };
      mounted = { projectId, sampleRate, frameCount, recordingId, pieces };
      pageReads = createPageReads({
        readers: current,
        layouts,
        sampleRate,
        putPage: (page) => {
          playerPort.methods.putPage(page);
        },
        dropPages: (pages) => {
          playerPort.methods.dropPages({ pages });
        },
        putLeadPage: (page) => {
          spectrogramPort.methods.putLeadPage(page);
        },
        failed: (error) => {
          console.error('Failed to read a page of a stem', error);
        },
      });
      spectrogramPort.methods.mount({
        lead: layouts.lead,
        recording: copyPieces(pieces),
      });
      playerPort.methods.mount({
        frameCount,
        layouts,
        residentPageLimit: pageReads.residentLimit,
        recording: copyPieces(pieces),
      });
      const pending = reloadOnMount;
      reloadOnMount = undefined;
      if (pending || activeRecordingId !== recordingId) {
        queueReload(pending ?? {}).catch((error: unknown) => {
          console.error('Failed to reload the recording', error);
        });
      }
      return { frameCount };
    },
    setActiveRecording: (recordingId) => {
      if (activeRecordingId === recordingId) {
        return;
      }
      activeRecordingId = recordingId;
      if (!mounted) {
        return;
      }
      queueReload({ switched: true }).catch((error: unknown) => {
        console.error('Failed to switch the recording', error);
      });
    },
    beginLiveTake: (take) => {
      playerPort.methods.beginLiveTake(take);
      spectrogramPort.methods.beginLiveTake(take);
    },
    patchLiveTake: (chunk) => {
      playerPort.methods.appendLiveTake({
        ...chunk,
        samples: chunk.samples.slice(),
      });
      spectrogramPort.methods.appendLiveTake({
        ...chunk,
        samples: chunk.samples.slice(),
      });
    },
    clearLiveTake: (takeId) => {
      const current = mounted;
      if (!current) {
        return;
      }
      playerPort.methods.setRecordingPieces({
        pieces: copyPieces(current.pieces),
        finishedTakeId: takeId,
      });
      spectrogramPort.methods.setRecordingPieces({
        pieces: copyPieces(current.pieces),
        finishedTakeId: takeId,
      });
    },
    reloadRecording: async (finishedTakeId) => queueReload({ finishedTakeId }),
    requestTarget: (window) => {
      pageReads?.requestTarget(window);
    },
    unmount: () => {
      mounted = undefined;
      pageReads?.close();
      pageReads = undefined;
      reloadOnMount = undefined;
      activeRecordingId = undefined;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
