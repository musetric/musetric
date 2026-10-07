import { decodeMp4 } from '@musetric/audio/decoder';
import { getDeliveryAudioContent } from '../audioRequest/audioRequest.worker.js';
import {
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

export type RecordingChunk = {
  frameIndex: number;
  samples: Float32Array;
};

export type AudioDecode = {
  mount: (message: { projectId: number; sampleRate: number }) => Promise<{
    frameCount: number;
  }>;
  beginLiveTake: (take: LiveTakeStart) => void;
  patchLiveTake: (chunk: RecordingChunk) => void;
  reloadRecording: (finishedTakeId?: string) => Promise<void>;
  exportRecording: () => Promise<Float32Array<ArrayBuffer>>;
  unmount: () => void;
};

type MountedAudio = {
  projectId: number;
  sampleRate: number;
  frameCount: number;
  pieces: PlayerRecordingPiece[];
};

type Recording = {
  assembly: RecordingAssembly;
  stretch: Promise<TakeStretch>;
};

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { playerPort, spectrogramPort } = options;
  let mounted: MountedAudio | undefined = undefined;
  let recording: Recording | undefined = undefined;
  let reloading: Promise<void> = Promise.resolve();
  let reloadOnMount: { finishedTakeId?: string } | undefined = undefined;

  const getRecording = (sampleRate: number): Recording => {
    recording ??= {
      assembly: createRecordingAssembly(sampleRate),
      stretch: createTakeStretch(sampleRate),
    };
    return recording;
  };

  const reloadPieces = async (finishedTakeId?: string): Promise<void> => {
    const current = mounted;
    if (!current) {
      reloadOnMount = { finishedTakeId };
      return;
    }
    const pieces = await getRecording(current.sampleRate).assembly.load(
      current.projectId,
    );
    if (mounted !== current) {
      return;
    }
    current.pieces = pieces;
    playerPort.methods.setRecordingPieces({
      pieces: copyPieces(pieces),
      finishedTakeId,
    });
    spectrogramPort.methods.setRecordingPieces({
      pieces: copyPieces(pieces),
      finishedTakeId,
    });
  };

  const reloadRecording = async (finishedTakeId?: string): Promise<void> => {
    const next = reloading
      .catch(() => undefined)
      .then(async () => reloadPieces(finishedTakeId));
    reloading = next;
    await next;
  };

  return {
    mount: async (message) => {
      const { projectId, sampleRate } = message;
      const { assembly } = getRecording(sampleRate);
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
        assembly.load(projectId),
      ]);
      const frameCount = Math.max(
        lead.frameCount,
        backing.frameCount,
        instrumental.frameCount,
      );
      mounted = { projectId, sampleRate, frameCount, pieces };
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
      if (reloadOnMount) {
        const { finishedTakeId } = reloadOnMount;
        reloadOnMount = undefined;
        reloadRecording(finishedTakeId).catch((error: unknown) => {
          console.error('Failed to reload the recording', error);
        });
      }
      return { frameCount };
    },
    beginLiveTake: (take) => {
      playerPort.methods.beginLiveTake(take);
      spectrogramPort.methods.beginLiveTake(take);
    },
    patchLiveTake: (chunk) => {
      playerPort.methods.appendLiveTake({
        frameIndex: chunk.frameIndex,
        samples: chunk.samples.slice(),
      });
      spectrogramPort.methods.appendLiveTake({
        frameIndex: chunk.frameIndex,
        samples: chunk.samples.slice(),
      });
    },
    reloadRecording,
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
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
