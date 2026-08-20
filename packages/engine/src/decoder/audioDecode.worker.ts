import { decodeMp4, decodeWav } from '@musetric/audio/decoder';
import {
  getDeliveryAudioContent,
  getRecordingAudioContent,
} from '../audioRequest/audioRequest.worker.js';
import { type playerDataChannel } from '../player/protocol.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';

const fitChannelToFrameCount = (
  channel: Float32Array<ArrayBuffer>,
  frameCount: number,
): Float32Array<ArrayBuffer> => {
  if (channel.length === frameCount) {
    return channel;
  }
  const fitted = new Float32Array(frameCount);
  fitted.set(channel.subarray(0, frameCount));
  return fitted;
};

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

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { playerPort, spectrogramPort } = options;
  let recordingFrameCount = 0;

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
      recordingFrameCount = frameCount;
      const recordingChannels = recording.channels.map((channel) =>
        fitChannelToFrameCount(channel, frameCount),
      );
      spectrogramPort.methods.mount({
        samples: {
          lead: lead.channels[0].slice(),
          recording: recordingChannels[0].slice(),
        },
      });
      playerPort.methods.mount({
        frameCount,
        tracks: {
          lead: lead.channels,
          backing: backing.channels,
          instrumental: instrumental.channels,
          recording: recordingChannels,
        },
      });
      return { frameCount };
    },
    patchRecordingSamples: (message) => {
      const skippedFrameCount = Math.max(0, -message.frameIndex);
      const frameIndex = Math.max(0, message.frameIndex);
      const frameCount = Math.min(
        message.samples.length - skippedFrameCount,
        recordingFrameCount - frameIndex,
      );
      if (frameCount <= 0) {
        return;
      }
      const patch = message.samples.subarray(
        skippedFrameCount,
        skippedFrameCount + frameCount,
      );
      playerPort.methods.patchRecording({
        frameIndex,
        samples: patch.slice(),
      });
      spectrogramPort.methods.patchSamples({
        trackKey: 'recording',
        frameIndex,
        samples: patch.slice(),
      });
    },
    unmount: () => {
      recordingFrameCount = 0;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
