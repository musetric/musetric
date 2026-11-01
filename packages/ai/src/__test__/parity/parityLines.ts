import { createWhisperRuntime } from '../../runtime/whisper/whisperRuntime.js';
import { buildCompaction } from '../../transcription/audioCompaction.js';
import { sampleRate } from '../../transcription/spectralChunker.js';
import {
  decodeChunksPass,
  finalizePass,
  planPass,
  repairPass,
} from '../../transcription/transcribePipeline.js';
import { type PayloadSegment } from '../../transcription/types.js';
import {
  fetchTensor,
  type ParityLinesTask,
  type ParityOutput,
} from './parityJob.js';
import { lineBreakRows, lineWordRows } from './parityLineRows.js';

const chunkSize = 30;
const seamSeconds = 2;

const rowsOutput = (boundary: string, values: Int32Array): ParityOutput => ({
  boundary,
  source: 'product',
  dtype: 'int32',
  shape: [values.length / 2, 2],
  values,
});

const textOutput = (lines: PayloadSegment[]): ParityOutput => {
  const text = lines.map((line) => line.text).join(' / ');
  const values = Int32Array.from(text, (character) =>
    Number(character.codePointAt(0)),
  );
  return {
    boundary: 'lines.text',
    source: 'product',
    dtype: 'int32',
    shape: [values.length],
    values,
  };
};

export const runLinesTask = async (
  task: ParityLinesTask,
): Promise<ParityOutput[]> => {
  const voice = Float32Array.from(await fetchTensor(task.voice));
  const runtime = await createWhisperRuntime({
    graph: task.graph,
    modelHost: `${location.origin}${task.modelPath}`,
    modelId: task.modelId,
    revision: task.revision,
    report: { loading: () => undefined, building: () => undefined },
  });
  try {
    const { language, packed } = await planPass(voice, {
      chunkSize,
      seamSeconds,
      detectLanguage: runtime.detectLanguage,
    });
    const { compacted, chunks, mapping } = buildCompaction(
      voice,
      packed,
      seamSeconds,
    );
    const words = await decodeChunksPass(
      chunks.map((chunk) =>
        compacted.subarray(
          Math.round(chunk.start * sampleRate),
          Math.round(chunk.end * sampleRate),
        ),
      ),
      language,
      runtime.transcribeBatch,
    );
    const replaced = await repairPass({
      compacted,
      packed,
      chunks,
      mapping,
      words,
      language,
      transcribeAligned: runtime.transcribeAligned,
      transcribeBatch: runtime.transcribeBatch,
      transcribePrompted: runtime.transcribePrompted,
    });
    const lines = finalizePass({
      compacted,
      packed,
      seamSeconds,
      words,
      replaced,
    });
    return [
      rowsOutput('lines.words', lineWordRows(lines)),
      rowsOutput('lines.breaks', lineBreakRows(lines)),
      textOutput(lines),
    ];
  } finally {
    await runtime.release();
  }
};
