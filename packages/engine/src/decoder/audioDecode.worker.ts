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
  reloadRecording: () => Promise<boolean>;
  unmount: () => void;
};

type MountedAudio = {
  projectId: number;
  sampleRate: number;
};

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { playerPort, spectrogramPort } = options;
  let recordingFrameCount = 0;
  let recordingVersion = 0;
  let mountedAudio: MountedAudio | undefined = undefined;
  let reloadOnMount = false;

  const replaceRecording = (samples: Float32Array<ArrayBuffer>): void => {
    playerPort.methods.patchRecording({
      frameIndex: 0,
      samples: samples.slice(),
    });
    spectrogramPort.methods.patchSamples({
      trackKey: 'recording',
      frameIndex: 0,
      samples: samples.slice(),
    });
  };

  const reloadRecording = async (): Promise<boolean> => {
    const mounted = mountedAudio;
    if (!mounted) {
      reloadOnMount = true;
      return true;
    }
    recordingVersion += 1;
    const version = recordingVersion;
    const content = await getRecordingAudioContent(mounted.projectId);
    const recording = await decodeWav(content.buffer, mounted.sampleRate);
    if (version !== recordingVersion || mountedAudio !== mounted) {
      return false;
    }
    replaceRecording(
      fitChannelToFrameCount(recording.channels[0], recordingFrameCount),
    );
    return true;
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
      recordingFrameCount = frameCount;
      mountedAudio = { projectId, sampleRate };
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
      if (reloadOnMount) {
        reloadOnMount = false;
        reloadRecording().catch((error: unknown) => {
          console.error('Failed to reload the recording', error);
        });
      }
      return { frameCount };
    },
    patchRecordingSamples: (message) => {
      recordingVersion += 1;
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
    reloadRecording,
    unmount: () => {
      reloadOnMount = false;
      recordingFrameCount = 0;
      mountedAudio = undefined;
      playerPort.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
