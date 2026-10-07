import { type TimePitchProcessor } from '@musetric/audio/player';
import {
  firstSegmentEndingAfter,
  type RecordingPiece,
  type RecordingSegment,
} from './recordingPieces.cross.js';

const unitRatioTolerance = 1e-6;
const continuityFrames = 4;

export type VoiceBlock = {
  output: Float32Array;
  songFrame: number;
  tempoRatio: number;
  transposeSemitones: number;
};

export type Voice = {
  setSegments: (segments: readonly RecordingSegment[]) => void;
  render: (block: VoiceBlock) => boolean;
};

type SegmentBlock = {
  output: Float32Array;
  segment: RecordingSegment;
  songFrame: number;
};

type Played = {
  piece: RecordingPiece;
  stretched: boolean;
  songEndFrame: number;
  rawEndFrame: number;
};

export const createVoice = (stretcher: TimePitchProcessor): Voice => {
  let segments: readonly RecordingSegment[] = [];
  let previous: Played | undefined = undefined;
  let current: Played | undefined = undefined;

  const renderSegment = (block: VoiceBlock, part: SegmentBlock): void => {
    const { piece } = part.segment;
    const { samples } = piece;
    const ratio = block.tempoRatio / piece.tempo;
    const stretched =
      Math.abs(ratio - 1) >= unitRatioTolerance ||
      block.transposeSemitones !== 0;
    const continued =
      previous !== undefined &&
      previous.piece === piece &&
      previous.stretched === stretched &&
      Math.abs(previous.songEndFrame - part.songFrame) <= continuityFrames;
    const mapped = Math.round(
      (part.songFrame - piece.songStartFrame) / piece.tempo,
    );
    const position =
      continued && !stretched ? (previous?.rawEndFrame ?? mapped) : mapped;
    current = {
      piece,
      stretched,
      songEndFrame: part.songFrame + part.output.length * block.tempoRatio,
      rawEndFrame: position + part.output.length,
    };
    if (!stretched) {
      for (let index = 0; index < part.output.length; index += 1) {
        part.output[index] = samples[position + index] ?? 0;
      }
      return;
    }
    if (!continued) {
      stretcher.reset();
    }
    stretcher.setTempoRatio(ratio);
    stretcher.setTransposeSemitones(block.transposeSemitones);
    stretcher.process([part.output], (inputs, inputFrameOffset, count) => {
      const [input] = inputs;
      for (let index = 0; index < count; index += 1) {
        input[index] = samples[position + inputFrameOffset + index] ?? 0;
      }
    });
  };

  return {
    setSegments: (next) => {
      segments = next;
    },
    render: (block) => {
      const { output, songFrame, tempoRatio } = block;
      previous = current;
      current = undefined;
      output.fill(0);
      let written = false;
      let offset = 0;
      for (
        let index = firstSegmentEndingAfter(segments, songFrame);
        index < segments.length && offset < output.length;
        index += 1
      ) {
        const segment = segments[index];
        const start = Math.max(
          offset,
          Math.ceil((segment.songStartFrame - songFrame) / tempoRatio),
        );
        const end = Math.min(
          output.length,
          Math.ceil((segment.songEndFrame - songFrame) / tempoRatio),
        );
        if (start >= output.length) {
          break;
        }
        if (end > start) {
          renderSegment(block, {
            output: output.subarray(start, end),
            segment,
            songFrame: songFrame + start * tempoRatio,
          });
          written = true;
        }
        offset = Math.max(offset, end);
      }
      return written;
    },
  };
};
