import { createTimePitchProcessor } from '@musetric/audio/player';
import {
  type MixTrackFrames,
  mixTrackIntoBuffers,
} from './mixTrack.worklet.js';

export type LeadVoiceMixOptions = {
  outputs: Float32Array[];
  outputFrameIndex: number;
  track: Float32Array[] | undefined;
  volume: number;
  frames?: MixTrackFrames;
};

export type LeadVoice = {
  setTransposeSemitones: (transposeSemitones: number) => void;
  setTempoRatio: (tempoRatio: number) => void;
  reset: () => void;
  mixInto: (options: LeadVoiceMixOptions) => void;
};

export const createLeadVoice = async (
  sampleRate: number,
): Promise<LeadVoice> => {
  const processor = await createTimePitchProcessor(sampleRate);
  processor.setFormantCompensation(true);
  let buffers: Float32Array[] = [];

  const getBuffers = (outputs: Float32Array[]) => {
    const outputFrameCount = outputs[0].length;
    if (
      buffers.length !== outputs.length ||
      buffers.some((buffer) => buffer.length !== outputFrameCount)
    ) {
      buffers = outputs.map(() => new Float32Array(outputFrameCount));
    }
    for (const buffer of buffers) {
      buffer.fill(0);
    }
    return buffers;
  };

  return {
    setTransposeSemitones: processor.setTransposeSemitones,
    setTempoRatio: processor.setTempoRatio,
    reset: processor.reset,
    mixInto: (options) => {
      const { outputs, outputFrameIndex, track, volume, frames } = options;
      const leadBuffers = getBuffers(outputs);
      processor.process(
        leadBuffers,
        (inputBuffers, inputFrameOffset, inputFrameCount) => {
          mixTrackIntoBuffers({
            inputBuffers,
            outputFrameIndex,
            inputFrameOffset,
            inputFrameCount,
            channelCount: outputs.length,
            track,
            volume,
            frames,
          });
        },
      );
      for (
        let channelIndex = 0;
        channelIndex < outputs.length;
        channelIndex += 1
      ) {
        const output = outputs[channelIndex];
        const lead = leadBuffers[channelIndex];
        for (let offset = 0; offset < output.length; offset += 1) {
          output[offset] += lead[offset];
        }
      }
    },
  };
};
