export type StereoAudio = {
  sampleRate: number;
  samples: number;
  channels: 2;
  data: Float32Array<ArrayBuffer>;
};

export const interleavedToPlanar = (
  interleaved: Float32Array<ArrayBuffer>,
  sampleRate: number,
): StereoAudio => {
  const channels = 2;
  const samples = Math.floor(interleaved.length / channels);
  const data = new Float32Array(samples * channels);
  for (let sample = 0; sample < samples; sample++) {
    for (let channel = 0; channel < channels; channel++) {
      data[channel * samples + sample] =
        interleaved[sample * channels + channel];
    }
  }
  return { sampleRate, samples, channels, data };
};

export const planarToInterleaved = (
  audio: StereoAudio,
): Float32Array<ArrayBuffer> => {
  const interleaved = new Float32Array(audio.samples * audio.channels);
  for (let sample = 0; sample < audio.samples; sample++) {
    for (let channel = 0; channel < audio.channels; channel++) {
      interleaved[sample * audio.channels + channel] =
        audio.data[channel * audio.samples + sample];
    }
  }
  return interleaved;
};
