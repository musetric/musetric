import { vocalsGraphOf } from '../runtime/modelGraphs.js';
import { createVocalsGpuRuntime } from '../runtime/vocals/vocalsRuntime.js';
import {
  separateTrack,
  type SeparationSource,
} from '../separation/separateTrack.js';
import {
  peakOf,
  stemNames,
  stereoChannels,
} from '../separation/separationStems.js';
import { createBrowserJobApi } from './browserJob.js';
import {
  fetchModelFiles,
  loadModel,
  releaseModelFiles,
} from './browserModelLoad.js';
import { fetchBytes, fetchOk } from './browserShared.js';
import { putUnitOutput } from './browserUnitServing.js';
import {
  type BrowserSeparateRequest,
  type BrowserSeparateResult,
  separationStateOutput,
} from './separationApi.js';

const partialContent = 206;
const frameBytes = stereoChannels * Float32Array.BYTES_PER_ELEMENT;

const readMixturePeak = async (url: string): Promise<number> => {
  const response = await fetchOk(url, 'the mixture');
  if (!response.body) {
    throw new Error('The mixture answered without a body');
  }
  const reader = response.body.getReader();
  let carry = new Uint8Array(0);
  let peak = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      return peak;
    }
    const bytes = new Uint8Array(carry.length + read.value.length);
    bytes.set(carry);
    bytes.set(read.value, carry.length);
    const whole =
      bytes.length - (bytes.length % Float32Array.BYTES_PER_ELEMENT);
    peak = Math.max(
      peak,
      peakOf(
        new Float32Array(
          bytes.buffer,
          0,
          whole / Float32Array.BYTES_PER_ELEMENT,
        ),
      ),
    );
    carry = bytes.slice(whole);
  }
};

const createMixtureSource = (
  mixture: BrowserSeparateRequest['mixture'],
): SeparationSource => ({
  frames: mixture.frames,
  peak: async () => readMixturePeak(mixture.url),
  read: async (start, channels) => {
    const frames = channels[0].length;
    const first = start * frameBytes;
    const last = (start + frames) * frameBytes - 1;
    const response = await fetchOk(mixture.url, 'the mixture', {
      headers: { range: `bytes=${String(first)}-${String(last)}` },
    });
    const interleaved = new Float32Array(await response.arrayBuffer());
    if (
      response.status !== partialContent ||
      interleaved.length !== frames * stereoChannels
    ) {
      throw new Error(
        `The mixture did not answer frames ${String(start)} to ${String(start + frames)}`,
      );
    }
    for (const [channel, samples] of channels.entries()) {
      for (let frame = 0; frame < frames; frame += 1) {
        samples[frame] = interleaved[frame * stereoChannels + channel];
      }
    }
  },
});

const bytesOf = (values: Float32Array<ArrayBuffer>): Uint8Array<ArrayBuffer> =>
  new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

export const separate = createBrowserJobApi<BrowserSeparateRequest>(
  async (request, context): Promise<BrowserSeparateResult> => {
    const graph = vocalsGraphOf(request.graph);
    const resume =
      request.stateUrl === undefined
        ? undefined
        : await fetchBytes(request.stateUrl, 'the separation state');
    const scales = await separateTrack({
      geometry: {
        sampleRate: request.sampleRate,
        chunkSamples: graph.chunkSamples,
      },
      channels: graph.channels,
      masks: graph.masks,
      source: createMixtureSource(request.mixture),
      resume,
      loadModel: async () =>
        loadModel(context, async (report) => {
          const [modelFile, modelDataFile] = await fetchModelFiles(
            [request.vocalsModelUrl, request.vocalsModelDataUrl],
            report,
          );
          const created = await createVocalsGpuRuntime({
            graph,
            modelFile,
            modelDataFile,
            modelDataPath: request.vocalsModelDataPath,
          });
          releaseModelFiles([modelFile, modelDataFile]);
          return created;
        }),
      report: (unit, unitCount) => {
        context.reportRunning({ unit, unitCount });
      },
      commit: async (commit) => {
        const { unit, stems, state } = commit;
        for (const name of stemNames) {
          await putUnitOutput(
            request.attemptUrl,
            unit,
            name,
            bytesOf(stems[name]),
          );
        }
        await putUnitOutput(
          request.attemptUrl,
          unit,
          separationStateOutput,
          state,
        );
      },
    });
    return { scales };
  },
);
