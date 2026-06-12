export type StereoAudio = {
  sampleRate: number;
  samples: number;
  channels: 2;
  data: Float32Array<ArrayBuffer>;
};
