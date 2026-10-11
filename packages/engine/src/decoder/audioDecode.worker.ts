import { decodeMp4 } from '@musetric/audio/decoder';
import { getDeliveryAudioContent } from '../audioRequest/audioRequest.worker.js';
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
  renderPieces,
} from './recordingAssembly.worker.js';
import { createTakeStretch, type TakeStretch } from './takeStretch.worker.js';

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
  reloadRecording: (finishedTakeId?: string) => Promise<void>;
  exportRecording: () => Promise<Float32Array<ArrayBuffer>>;
  unmount: () => void;
};

type MountedAudio = {
  projectId: number;
  sampleRate: number;
  frameCount: number;
  recordingId: number | undefined;
  pieces: PlayerRecordingPiece[];
};

type Recording = {
  assembly: RecordingAssembly;
  stretch: Promise<TakeStretch>;
};

type Reload = {
  finishedTakeId?: string;
  switched?: boolean;
};

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { playerPort, spectrogramPort } = options;
  let mounted: MountedAudio | undefined = undefined;
  let recording: Recording | undefined = undefined;
  let activeRecordingId: number | undefined = undefined;
  let reloading: Promise<void> = Promise.resolve();
  let reloadOnMount: Reload | undefined = undefined;

  const getRecording = (sampleRate: number): Recording => {
    recording ??= {
      assembly: createRecordingAssembly(sampleRate),
      stretch: createTakeStretch(sampleRate),
    };
    return recording;
  };

  const loadPieces = async (
    current: Pick<MountedAudio, 'projectId' | 'sampleRate'>,
    recordingId: number | undefined,
  ): Promise<PlayerRecordingPiece[]> => {
    if (recordingId === undefined) {
      return [];
    }
    return await getRecording(current.sampleRate).assembly.load(
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
      const [lead, backing, instrumental, pieces] = await Promise.all([
        getDeliveryAudioContent(projectId, 'lead').then(async (content) =>
          decodeMp4(content.buffer, sampleRate),
        ),
        getDeliveryAudioContent(projectId, 'backing').then(async (content) =>
          decodeMp4(content.buffer, sampleRate),
        ),
        getDeliveryAudioContent(projectId, 'instrumental').then(
          async (content) => decodeMp4(content.buffer, sampleRate),
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
    reloadRecording: async (finishedTakeId) => queueReload({ finishedTakeId }),
    exportRecording: async () => {
      await reloading.catch(() => undefined);
      const current = mounted;
      if (!current) {
        return new Float32Array(0);
      }
      const stretch = await getRecording(current.sampleRate).stretch;
      return renderPieces(current.pieces, current.frameCount, stretch);
    },
    unmount: () => {
      mounted = undefined;
      reloadOnMount = undefined;
      activeRecordingId = undefined;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
