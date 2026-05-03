import { type StemType, stemTypes } from '../../common/stemType.es.js';
import {
  type playerChannel,
  type playerDataChannel,
} from '../protocol.cross.js';
import { createTimePitchProcessor } from '../timePitchProcessor.js';
import { createFrameIndexTracker } from '../trackFrameIndex.js';

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
};

export type PlayerRuntime = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  process: (outputs: Float32Array[]) => void;
};

export const createPlayerRuntime = async (
  options: CreatePlayerRuntimeOptions,
): Promise<PlayerRuntime> => {
  const { port, dataPort } = options;

  let frameCount = 0;
  let tracks: Record<StemType, Float32Array[]> | undefined = undefined;
  let frameIndex = 0;
  let playing = false;
  const trackVolumes: Partial<Record<StemType, number>> = {};
  const frameIndexTracker = createFrameIndexTracker(sampleRate);
  const timePitchProcessor = await createTimePitchProcessor(sampleRate);

  dataPort.bindHandlers({
    mount: (message) => {
      frameCount = message.frameCount;
      tracks = message.tracks;
      frameIndex = 0;
      playing = false;
      port.methods.setPlaying({ playing, frameIndex });
    },
    unmount: () => {
      frameCount = 0;
      tracks = undefined;
      frameIndex = 0;
      playing = false;
      frameIndexTracker.reset();
      timePitchProcessor.reset();
      port.methods.setPlaying({ playing, frameIndex });
    },
  });

  port.bindHandlers({
    play: () => {
      if (!tracks) {
        return;
      }

      playing = true;
      port.methods.setPlaying({ playing, frameIndex });
    },
    pause: () => {
      playing = false;
      frameIndexTracker.reset();
      port.methods.setPlaying({ playing, frameIndex });
    },
    seek: (message) => {
      frameIndex = message.frameIndex;
      frameIndexTracker.reset();
      timePitchProcessor.reset();
      port.methods.setFrameIndex({ frameIndex, positionJump: true });
    },
    setTransposeSemitones: (message) => {
      timePitchProcessor.setTransposeSemitones(message.transposeSemitones);
    },
    setTempoRatio: (message) => {
      timePitchProcessor.setTempoRatio(message.tempoRatio);
    },
    setTrackVolume: (message) => {
      trackVolumes[message.stemType] = message.volume;
    },
  });

  return {
    port,
    process: (outputs) => {
      for (const output of outputs) {
        output.fill(0);
      }

      if (!tracks || !playing) {
        return;
      }

      const currentTracks = tracks;
      frameIndex += timePitchProcessor.process(
        outputs,
        (inputs, inputFrameOffset, inputFrameCount) => {
          for (const stemType of stemTypes) {
            const track = currentTracks[stemType];
            const volume = trackVolumes[stemType] ?? 1;

            for (
              let channelIndex = 0;
              channelIndex < outputs.length;
              channelIndex += 1
            ) {
              const input = inputs[channelIndex];
              const samples = track[channelIndex];
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              if (!samples) {
                continue;
              }

              for (let offset = 0; offset < inputFrameCount; offset += 1) {
                const sample =
                  samples[frameIndex + inputFrameOffset + offset] ?? 0;
                input[offset] += sample * volume;
              }
            }
          }
        },
      );

      if (frameIndex >= frameCount) {
        frameIndex = 0;
        playing = false;
        frameIndexTracker.reset();
        timePitchProcessor.reset();
        port.methods.setPlaying({ playing, frameIndex, positionJump: true });
        return;
      }

      if (frameIndexTracker.advance(outputs[0].length)) {
        port.methods.setFrameIndex({ frameIndex });
      }
    },
  };
};
