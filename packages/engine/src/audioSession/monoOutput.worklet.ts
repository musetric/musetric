export const fillMonoOutput = (
  outputs: Float32Array[][],
  render: (channel: Float32Array) => void,
): void => {
  render(outputs[0][0]);
  for (let index = 1; index < outputs[0].length; index += 1) {
    outputs[0][index].set(outputs[0][0]);
  }
};
