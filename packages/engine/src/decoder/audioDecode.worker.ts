import { decodeMp4, decodeWav } from '@musetric/audio/decoder';
import {
  getDeliveryAudioContent,
  getRecordingAudioContent,
} from '../audioRequest/audioRequest.worker.js';
import { type playerDataChannel } from '../player/protocol.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';

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
  patchRecordingSamples: (message: {
    frameIndex: number;
    samples: Float32Array;
  }) => void;
  unmount: () => void;
};

const createSharedChannel = (samples: Float32Array, frameCount: number) => {
  const shared = new SharedArrayBuffer(
    frameCount * Float32Array.BYTES_PER_ELEMENT,
  );
  const sharedSamples = new Float32Array(shared);
  sharedSamples.set(samples.subarray(0, frameCount));
  return sharedSamples;
};

const fitChannelsToFrameCount = (
  channels: Float32Array<SharedArrayBuffer>[],
  frameCount: number,
): Float32Array<SharedArrayBuffer>[] => {
  const [left, right] = channels;
  if (left.length === frameCount && right.length === frameCount) {
    return [left, right];
  }
  return [
    createSharedChannel(left, frameCount),
    createSharedChannel(right, frameCount),
  ];
};

type RecordingSamplesChange = {
  frameIndex: number;
  frameCount: number;
};

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { playerPort, spectrogramPort } = options;
  let recordingChannels: Float32Array<SharedArrayBuffer>[] | undefined =
    undefined;

  const notifyRecordingSamplesChanged = (change: RecordingSamplesChange) => {
    if (change.frameCount <= 0) {
      return;
    }
    spectrogramPort.methods.samplesChanged({
      trackKey: 'recording',
      frameIndex: change.frameIndex,
      frameCount: change.frameCount,
    });
  };

  const writeRecordingSamples = (
    frameIndex: number,
    samples: Float32Array,
  ): RecordingSamplesChange => {
    const channels = recordingChannels;
    if (!channels) {
      return { frameIndex, frameCount: 0 };
    }
    const recordingFrameCount = channels[0].length;
    if (recordingFrameCount <= 0) {
      return { frameIndex, frameCount: 0 };
    }
    const skippedFrameCount = Math.max(0, -frameIndex);
    const targetFrameIndex = Math.max(0, frameIndex);
    if (
      targetFrameIndex >= recordingFrameCount ||
      skippedFrameCount >= samples.length
    ) {
      return { frameIndex: targetFrameIndex, frameCount: 0 };
    }
    const frameCount = Math.min(
      samples.length - skippedFrameCount,
      recordingFrameCount - targetFrameIndex,
    );
    const patch = samples.subarray(
      skippedFrameCount,
      skippedFrameCount + frameCount,
    );
    for (const channel of channels) {
      channel.set(patch, targetFrameIndex);
    }
    return { frameIndex: targetFrameIndex, frameCount };
  };

  return {
    mount: async (message) => {
      const { projectId, sampleRate } = message;
      const [lead, backing, instrumental, recording] = await Promise.all([
        getDeliveryAudioContent(projectId, 'lead').then(async (content) =>
          decodeMp4(content.buffer, sampleRate),
        ),
        getDeliveryAudioContent(projectId, 'backing').then(async (content) =>
          decodeMp4(content.buffer, sampleRate),
        ),
        getDeliveryAudioContent(projectId, 'instrumental').then(
          async (content) => decodeMp4(content.buffer, sampleRate),
        ),
        getRecordingAudioContent(projectId).then(async (content) =>
          decodeWav(content.buffer, sampleRate),
        ),
      ]);
      const frameCount = Math.max(
        lead.frameCount,
        backing.frameCount,
        instrumental.frameCount,
        recording.frameCount,
      );
      recordingChannels = fitChannelsToFrameCount(
        recording.channels,
        frameCount,
      );
      playerPort.methods.mount({
        frameCount,
        tracks: {
          lead: lead.channels,
          backing: backing.channels,
          instrumental: instrumental.channels,
          recording: recordingChannels,
        },
      });
      const [recordingLeft] = recordingChannels;
      spectrogramPort.methods.mount({
        samples: {
          lead: lead.channels[0],
          recording: recordingLeft,
        },
      });
      return { frameCount };
    },
    patchRecordingSamples: (message) => {
      const change = writeRecordingSamples(message.frameIndex, message.samples);
      notifyRecordingSamplesChanged(change);
    },
    unmount: () => {
      recordingChannels = undefined;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
