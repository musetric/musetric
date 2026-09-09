export type ChunkGeometry = {
  nFft: number;
  hop: number;
  frames: number;
  channels: number;
  chunkSamples: number;
};

export type VocalsGraph = ChunkGeometry & {
  inputName: string;
  outputName: string;
  minStorageBuffersPerShaderStage: number;
};

export type LeadBackingGraph = ChunkGeometry & {
  inputName: string;
  outputName: string;
  dimF: number;
};

export type BeatThisGraph = {
  inputName: string;
  beatOutputName: string;
  downbeatOutputName: string;
  nFft: number;
  hopLength: number;
  fps: number;
  melBins: number;
  logMultiplier: number;
  chunkSize: number;
  borderSize: number;
};

export type ChordNetGraph = {
  inputName: string;
  outputName: string;
  frameDuration: number;
  sequenceLength: number;
  inputBins: number;
  chordCount: number;
};

export type SkeyGraph = {
  inputName: string;
  outputName: string;
};

export type WhisperDtype =
  | 'auto'
  | 'bnb4'
  | 'fp16'
  | 'fp32'
  | 'int8'
  | 'q4'
  | 'q4f16'
  | 'q8'
  | 'uint8';

export type WhisperGraph = {
  dtype: Record<string, WhisperDtype>;
};
