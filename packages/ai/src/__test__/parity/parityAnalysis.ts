import { pickBeatTimes } from '../../rhythm/beatPeaks.js';
import {
  consecutiveProbeBpms,
  summarizeRhythm,
} from '../../rhythm/rhythmSummary.js';
import { createChordNetGpuRuntime } from '../../runtime/chords/chordNetGpuRuntime.js';
import { createSkeyRuntime } from '../../runtime/key/skeyRuntime.js';
import { createBeatThisGpuRuntime } from '../../runtime/rhythm/beatThisGpuRuntime.js';
import { fetchCqtPlan } from '../../service/browserChords.js';
import { argmax, peakNormalize } from '../../service/browserKey.js';
import { fetchFloat32 } from '../../service/browserShared.js';
import { readGpuBuffer } from './parityGpu.js';
import {
  fetchTensor,
  type ParityChordsTask,
  type ParityKeyTask,
  type ParityOutput,
  type ParityRhythmTask,
  type ParityTensorRef,
} from './parityJob.js';

const productOutput = (
  boundary: string,
  shape: number[],
  values: Float32Array | Int32Array,
): ParityOutput => ({
  boundary,
  source: 'product',
  dtype: values instanceof Int32Array ? 'int32' : 'float32',
  shape,
  values,
});

const eventsOutput = (boundary: string, times: number[]): ParityOutput =>
  productOutput(boundary, [times.length], Float32Array.from(times));

const fetchAudio = async (tensor: ParityTensorRef): Promise<Float32Array> =>
  Float32Array.from(await fetchTensor(tensor));

export const runRhythmTask = async (
  task: ParityRhythmTask,
): Promise<ParityOutput[]> => {
  const { graph } = task;
  const filterbank = await fetchFloat32(
    task.filterbankUrl,
    'rhythm mel filterbank',
  );
  const read: Float32Array[] = [];
  const runtime = await createBeatThisGpuRuntime({
    graph,
    modelUrl: task.modelUrl,
    filterbank,
    inspect: async (tap) => {
      read.push(await readGpuBuffer(tap.device, tap.windows));
    },
  });
  try {
    const audio = await fetchAudio(task.unitInput);
    const logits = await runtime.analyze(audio);
    const { beats, downbeats } = pickBeatTimes(
      logits.beat,
      logits.downbeat,
      graph.fps,
    );
    const duration = audio.length / (graph.hopLength * graph.fps);
    const result = summarizeRhythm(
      beats,
      downbeats,
      consecutiveProbeBpms(beats, duration),
    );
    const windows = read[0] ?? new Float32Array(0);
    return [
      productOutput(
        'features',
        [
          windows.length / (graph.chunkSize * graph.melBins),
          graph.chunkSize,
          graph.melBins,
        ],
        windows,
      ),
      productOutput('logits.beat', [logits.beat.length], logits.beat),
      productOutput(
        'logits.downbeat',
        [logits.downbeat.length],
        logits.downbeat,
      ),
      eventsOutput('result.beats', result.beats),
      eventsOutput('result.downbeats', result.downbeats),
      productOutput('result.bpm', [1], Float32Array.of(result.bpm)),
      productOutput('result.meter', [1], Float32Array.of(result.meter)),
    ];
  } finally {
    await runtime.release();
  }
};

export const runKeyTask = async (
  task: ParityKeyTask,
): Promise<ParityOutput[]> => {
  const runtime = await createSkeyRuntime({
    graph: task.graph,
    modelUrl: task.modelUrl,
  });
  try {
    const audio = await fetchAudio(task.unitInput);
    peakNormalize(audio);
    const modelInput = Float32Array.from(audio);
    const probs = await runtime.analyze(audio);
    return [
      productOutput('model.input', [1, modelInput.length], modelInput),
      productOutput('model.output', [probs.length], probs),
      productOutput('result.key', [1], Int32Array.of(argmax(probs))),
    ];
  } finally {
    await runtime.release();
  }
};

export const runChordsTask = async (
  task: ParityChordsTask,
): Promise<ParityOutput[]> => {
  const { graph } = task;
  const plan = await fetchCqtPlan(task.planUrl, task.planManifestUrl);
  const read: Float32Array[] = [];
  const runtime = await createChordNetGpuRuntime({
    graph,
    modelUrl: task.modelUrl,
    plan,
    inspect: async (tap) => {
      read.push(
        await readGpuBuffer(tap.device, tap.features),
        await readGpuBuffer(tap.device, tap.modelInput),
        await readGpuBuffer(tap.device, tap.logits),
      );
    },
  });
  try {
    const indices = await runtime.analyze(await fetchAudio(task.unitInput));
    const features = read[0] ?? new Float32Array(0);
    const runFrames = graph.windowsPerRun * graph.sequenceLength;
    return [
      productOutput(
        'features',
        [features.length / graph.inputBins, graph.inputBins],
        features,
      ),
      productOutput(
        'model.input',
        [graph.windowsPerRun, graph.sequenceLength, graph.inputBins],
        (read[1] ?? new Float32Array(0)).slice(0, runFrames * graph.inputBins),
      ),
      productOutput(
        'model.output',
        [graph.windowsPerRun, graph.sequenceLength, graph.chordCount],
        (read[2] ?? new Float32Array(0)).slice(0, runFrames * graph.chordCount),
      ),
      productOutput('result.indices', [indices.length], indices),
    ];
  } finally {
    await runtime.release();
  }
};
