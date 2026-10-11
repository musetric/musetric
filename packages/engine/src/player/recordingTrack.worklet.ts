import { createTimePitchProcessor } from '@musetric/audio/player';
import {
  continuesRun,
  createLiveRun,
  type LiveRun,
  liveRunPieces,
} from './liveTake.cross.js';
import {
  type LiveTakeChunk,
  type LiveTakeStart,
  type PlayerRecordingPiece,
  type RecordingPiecesUpdate,
} from './protocol.cross.js';
import {
  type RecordingPiece,
  toRecordingSegments,
} from './recordingPieces.cross.js';
import { createVoice } from './voice.worklet.js';

const toPiece = (piece: PlayerRecordingPiece): RecordingPiece => ({
  songStartFrame: piece.songStartFrame,
  tempo: piece.tempo,
  frameCount: piece.samples.length,
  samples: piece.samples,
});

type LiveTake = LiveTakeStart & {
  runs: LiveRun[];
};

export type RecordingMix = {
  outputs: Float32Array[];
  songFrame: number;
  tempoRatio: number;
  transposeSemitones: number;
  volume: number;
};

export type RecordingTrack = {
  setPieces: (update: RecordingPiecesUpdate) => void;
  beginLiveTake: (take: LiveTakeStart) => void;
  appendLiveTake: (chunk: LiveTakeChunk) => void;
  clear: () => void;
  mixInto: (mix: RecordingMix) => void;
};

export const createRecordingTrack = async (
  sampleRate: number,
): Promise<RecordingTrack> => {
  const voice = createVoice(await createTimePitchProcessor(sampleRate));
  let pieces: RecordingPiece[] = [];
  let live: LiveTake | undefined = undefined;
  let scratch = new Float32Array(128);

  const update = () => {
    const layers = live ? [...pieces, ...liveRunPieces(live.runs)] : pieces;
    voice.setSegments(toRecordingSegments(layers));
  };

  const appendToLive = (take: LiveTake, chunk: LiveTakeChunk) => {
    let run = take.runs.at(-1);
    if (!continuesRun(run, chunk)) {
      run = createLiveRun(chunk, take.tempo);
      take.runs.push(run);
    }
    const { piece } = run;
    const offset = chunk.offset - run.firstOffset;
    const end = offset + chunk.samples.length;
    if (end > piece.samples.length) {
      const grown = new Float32Array(
        Math.max(end, piece.samples.length * 2, sampleRate * 8),
      );
      grown.set(piece.samples.subarray(0, piece.frameCount));
      piece.samples = grown;
    }
    piece.samples.set(chunk.samples, offset);
    piece.frameCount = Math.max(piece.frameCount, end);
  };

  return {
    setPieces: (next) => {
      pieces = next.pieces.map(toPiece);
      if (live && (next.switched || live.takeId === next.finishedTakeId)) {
        live = undefined;
      }
      update();
    },
    beginLiveTake: (take) => {
      if (live?.takeId === take.takeId) {
        return;
      }
      live = { ...take, runs: [] };
      update();
    },
    appendLiveTake: (chunk) => {
      if (!live) {
        return;
      }
      appendToLive(live, chunk);
      update();
    },
    clear: () => {
      pieces = [];
      live = undefined;
      update();
    },
    mixInto: (mix) => {
      const frameCount = mix.outputs[0].length;
      if (scratch.length < frameCount) {
        scratch = new Float32Array(frameCount);
      }
      const output = scratch.subarray(0, frameCount);
      const written = voice.render({
        output,
        songFrame: mix.songFrame,
        tempoRatio: mix.tempoRatio,
        transposeSemitones: mix.transposeSemitones,
      });
      if (!written) {
        return;
      }
      for (const channel of mix.outputs) {
        for (let index = 0; index < frameCount; index += 1) {
          channel[index] += output[index] * mix.volume;
        }
      }
    },
  };
};
