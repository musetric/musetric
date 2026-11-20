export const fillMonoOutput = (
  outputs: Float32Array[][],
  render: (channel: Float32Array) => void,
): void => {
  const [output] = outputs;
  const [channel] = output;
  render(channel);
  for (let index = 1; index < output.length; index += 1) {
    output[index].set(channel);
  }
};
