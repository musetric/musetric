import { createAudioDecoder } from '@musetric/audio/decoder';
import { stemTypes } from '@musetric/audio/es';
import {
  type LiveTakeChunk,
  type LiveTakeStart,
  type playerDataChannel,
  type PlayerRecordingPiece,
} from '../player/protocol.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import {
  copyPieces,
  createRecordingAssembly,
  type RecordingAssembly,
} from './recordingAssembly.worker.js';
import {
  createStemDecoders,
  type StemDecoders,
} from './stemDecoders.worker.js';

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
  let stemDecoders: StemDecoders | undefined = undefined;
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

  return {
    mount: async (message) => {
      const { projectId, sampleRate } = message;
      const recordingId = activeRecordingId;
      stemDecoders ??= createStemDecoders(stemTypes.length);
      const decoders = stemDecoders;
      const [[lead, backing, instrumental], pieces] = await Promise.all([
        Promise.all(
          stemTypes.map(async (stem, slot) =>
            decoders.decode(slot, { projectId, stem, sampleRate }),
          ),
        ),
        loadPieces({ projectId, sampleRate }, recordingId),
      ]);
      const frameCount = Math.max(
        lead.frameCount,
        backing.frameCount,
        instrumental.frameCount,
      );
      mounted = { projectId, sampleRate, frameCount, recordingId, pieces };
      spectrogramPort.methods.mount({
        lead: lead.channels[0].slice(),
        recording: copyPieces(pieces),
      });
      playerPort.methods.mount({
        frameCount,
        tracks: {
          lead: lead.channels,
          backing: backing.channels,
          instrumental: instrumental.channels,
        },
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
    unmount: () => {
      mounted = undefined;
      reloadOnMount = undefined;
      activeRecordingId = undefined;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
