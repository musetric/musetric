type DownsampleParams = {
  inputCount: number;
  outputCount: number;
  tapCount: number;
  delay: number;
  gain: number;
};

export const createDownsampleParams = (
  params: DownsampleParams,
): ArrayBuffer => {
  const { inputCount, outputCount, tapCount, delay, gain } = params;
  const values = new ArrayBuffer(32);
  const integers = new Uint32Array(values);
  const floats = new Float32Array(values);
  integers[0] = inputCount;
  integers[1] = outputCount;
  integers[2] = tapCount;
  integers[3] = delay;
  floats[4] = gain;
  return values;
};

export const createFrameParams = (
  sampleCount: number,
  frameCount: number,
  hopLength: number,
  fftSize: number,
): ArrayBuffer =>
  new Uint32Array([sampleCount, frameCount, hopLength, fftSize]).buffer;

type ProjectParams = {
  frameCount: number;
  binStart: number;
  binCount: number;
  fftSize: number;
  outputBins: number;
  outputKind: number;
};

export const createProjectParams = (params: ProjectParams): ArrayBuffer => {
  const { frameCount, binStart, binCount, fftSize, outputBins, outputKind } =
    params;
  return new Uint32Array([
    frameCount,
    binStart,
    binCount,
    fftSize,
    outputBins,
    outputKind,
    0,
    0,
  ]).buffer;
};
