export type MixTrackIntoBuffersOptions = {
  inputBuffers: Float32Array[];
  outputFrameIndex: number;
  inputFrameOffset: number;
  inputFrameCount: number;
  channelCount: number;
  track: Float32Array[] | undefined;
  volume: number;
};

export const mixTrackIntoBuffers = (options: MixTrackIntoBuffersOptions) => {
  const {
    inputBuffers,
    outputFrameIndex,
    inputFrameOffset,
    inputFrameCount,
    channelCount,
    track,
    volume,
  } = options;
  if (!track) {
    return;
  }

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const input = inputBuffers[channelIndex];

    const samples = track[channelIndex] ?? track[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!samples) {
      continue;
    }

    const frameBase = outputFrameIndex + inputFrameOffset;
    for (let offset = 0; offset < inputFrameCount; offset += 1) {
      const sample = samples[frameBase + offset] ?? 0;
      input[offset] += sample * volume;
    }
  }
};
