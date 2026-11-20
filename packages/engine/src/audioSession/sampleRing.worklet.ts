import {
  captureInput,
  captureOutput,
  clearCapture,
  type InitOutput,
  initSync,
  openCapture,
  renderCapture,
  setCaptureStep,
  type SyncInitInput,
  writeCapture,
} from '@musetric/dsp/capture';

export const loadCapture = (module: SyncInitInput): InitOutput =>
  initSync({ module });

export type SampleRing = {
  write: (frame: number, samples: Float32Array) => void;
  setStep: (step: number) => void;
  render: (output: Float32Array, at: number, ratio: number) => number;
  clear: () => void;
};

export const createSampleRing = (capture: InitOutput): SampleRing => {
  const handle = openCapture();
  let output = new Float32Array(0);

  return {
    write: (frame, samples) => {
      const pointer = captureInput(handle, samples.length);
      new Float32Array(capture.memory.buffer, pointer, samples.length).set(
        samples,
      );
      writeCapture(handle, frame, samples.length);
    },
    setStep: (step) => {
      setCaptureStep(handle, step);
    },
    render: (target, at, ratio) => {
      const next = renderCapture(handle, at, ratio, target.length);
      const pointer = captureOutput(handle);
      if (
        output.buffer !== capture.memory.buffer ||
        output.byteOffset !== pointer ||
        output.length !== target.length
      ) {
        output = new Float32Array(capture.memory.buffer, pointer, target.length);
      }
      target.set(output);
      return next;
    },
    clear: () => {
      clearCapture(handle);
    },
  };
};
