import { type spectrogramDataChannel } from '@musetric/spectrogram';
import { type StemType } from '../../common/stemType.es.js';
import { type playerDataChannel } from '../../player/protocol.cross.js';
import { decodeMp4 } from '../mp4/index.js';
import { decodeWav } from '../wav/index.js';

export type CreateDecoderRuntimeOptions = {
  getDeliveryEncodedBuffer: (
    projectId: number,
    stemType: StemType,
  ) => Promise<ArrayBuffer>;
  getRecordingEncodedBuffer: (projectId: number) => Promise<ArrayBuffer>;
  playerPort: ReturnType<typeof playerDataChannel.outbound<MessagePort>>;
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
};

export type DecoderRuntime = {
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

export const createDecoderRuntime = (options: CreateDecoderRuntimeOptions) => {
  const {
    getDeliveryEncodedBuffer,
    getRecordingEncodedBuffer,
    playerPort,
    spectrogramPort,
  } = options;

  let recordingChannels: Float32Array<SharedArrayBuffer>[] | undefined =
    undefined;

  const notifyRecordingSamplesChanged = (frameCount: number) => {
    if (frameCount <= 0) {
      return;
    }

    spectrogramPort.methods.samplesChanged({ trackKey: 'recording' });
  };

  const getRecordingFrameCount = (): number => {
    const channels = recordingChannels;
    if (!channels) {
      return 0;
    }

    const [left] = channels;
    return left.length;
  };

  const writeRecordingSamples = (
    frameIndex: number,
    samples: Float32Array,
  ): number => {
    const channels = recordingChannels;
    if (!channels) {
      return 0;
    }

    const recordingFrameCount = getRecordingFrameCount();
    if (recordingFrameCount <= 0) {
      return 0;
    }

    const skippedFrameCount = Math.max(0, -frameIndex);
    const targetFrameIndex = Math.max(0, frameIndex);
    if (
      targetFrameIndex >= recordingFrameCount ||
      skippedFrameCount >= samples.length
    ) {
      return 0;
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
    return frameCount;
  };

  return {
    mount: async (message) => {
      const { projectId, sampleRate } = message;
      const [lead, backing, instrumental, recording] = await Promise.all([
        getDeliveryEncodedBuffer(projectId, 'lead').then(async (buffer) =>
          decodeMp4(buffer, sampleRate),
        ),
        getDeliveryEncodedBuffer(projectId, 'backing').then(async (buffer) =>
          decodeMp4(buffer, sampleRate),
        ),
        getDeliveryEncodedBuffer(projectId, 'instrumental').then(
          async (buffer) => decodeMp4(buffer, sampleRate),
        ),
        getRecordingEncodedBuffer(projectId).then(async (buffer) =>
          decodeWav(buffer, sampleRate),
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
      return {
        frameCount,
      };
    },
    patchRecordingSamples: (message) => {
      const frameCount = writeRecordingSamples(
        message.frameIndex,
        message.samples,
      );
      notifyRecordingSamplesChanged(frameCount);
    },
    unmount: () => {
      recordingChannels = undefined;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  } satisfies DecoderRuntime;
};
