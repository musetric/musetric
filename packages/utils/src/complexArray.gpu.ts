export type ComplexGpuBuffer = {
  real: GPUBuffer;
  imag: GPUBuffer;
};

export type ComplexCpuBuffer = {
  real: ArrayBuffer;
  imag: ArrayBuffer;
};

export type ComplexArray = {
  real: Float32Array<ArrayBuffer>;
  imag: Float32Array<ArrayBuffer>;
};

export const complexArrayFrom = (array: ComplexCpuBuffer): ComplexArray => ({
  real: new Float32Array(array.real),
  imag: new Float32Array(array.imag),
});
