import { createTimePitchProcessor } from '@musetric/audio/player';
import { type InitOutput } from '@musetric/dsp/stretch';
import { leadMask, type PlayerTracks } from './playerTracks.worklet.js';

export type LeadVoiceMixOptions = {
  outputs: Float32Array[];
  outputFrameIndex: number;
  tracks: PlayerTracks;
};

export type LeadVoice = {
  setTransposeSemitones: (transposeSemitones: number) => void;
  setTempoRatio: (tempoRatio: number) => void;
  reset: () => void;
  refill: () => void;
  mixInto: (options: LeadVoiceMixOptions) => void;
};

export const createLeadVoice = (
  stretch: InitOutput,
  sampleRate: number,
): LeadVoice => {
  const processor = createTimePitchProcessor(stretch, sampleRate);
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
    refill: processor.refill,
    mixInto: (options) => {
      const { outputs, outputFrameIndex, tracks } = options;
      const leadBuffers = getBuffers(outputs);
      processor.process(
        leadBuffers,
        outputFrameIndex,
        (inputBuffers, inputFrameOffset, inputFrameCount) => {
          tracks.mixInto(
            inputBuffers,
            outputFrameIndex + inputFrameOffset,
            inputFrameCount,
            leadMask,
          );
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
