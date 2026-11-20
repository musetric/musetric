import { type InitOutput } from '@musetric/dsp/capture';
import { createSampleRing } from '../audioSession/sampleRing.cross.js';

const kernelReach = 32;

export type CapturedPreview = {
  capturedAt: number;
  sampleRate: number;
  samples: Float32Array<ArrayBuffer>;
};

export type ContextPreview = {
  capturedAt: number;
  samples: Float32Array<ArrayBuffer>;
};

type PreviewRun = {
  sampleRate: number;
  startAt: number;
  written: number;
  next: number;
};

export const createLivePreview = (
  capture: InitOutput,
  contextSampleRate: number,
) => {
  const ring = createSampleRing(capture);
  let run: PreviewRun | undefined = undefined;

  const continues = (current: PreviewRun, chunk: CapturedPreview) =>
    current.sampleRate === chunk.sampleRate &&
    Math.abs(
      chunk.capturedAt -
        current.startAt -
        (current.written / current.sampleRate) * 1000,
    ) <=
      (chunk.samples.length / chunk.sampleRate) * 500;

  return (chunk: CapturedPreview): ContextPreview | undefined => {
    const { capturedAt, sampleRate, samples } = chunk;
    if (sampleRate === contextSampleRate) {
      run = undefined;
      return { capturedAt, samples };
    }
    const step = sampleRate / contextSampleRate;
    if (!run || !continues(run, chunk)) {
      ring.clear();
      ring.setStep(step);
      run = { sampleRate, startAt: capturedAt, written: 0, next: 0 };
    }
    ring.write(run.written, samples);
    run.written += samples.length;
    const count = Math.ceil((run.written - kernelReach) / step) - run.next;
    if (count <= 0) {
      return undefined;
    }
    const at = run.next * step;
    const output = new Float32Array(count);
    ring.render(output, at, step);
    run.next += count;
    return {
      capturedAt: run.startAt + (at / sampleRate) * 1000,
      samples: output,
    };
  };
};
