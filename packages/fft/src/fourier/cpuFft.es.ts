const reverseBits = (value: number, bits: number): number => {
  let result = 0;
  for (let bit = 0; bit < bits; bit += 1) {
    result = (result << 1) | ((value >> bit) & 1);
  }
  return result;
};

export type CpuFft = (re: Float64Array, im: Float64Array) => void;

export const createCpuFft = (size: number): CpuFft => {
  const bits = Math.log2(size);
  const reversed = Uint32Array.from({ length: size }, (_, index) =>
    reverseBits(index, bits),
  );
  const half = size / 2;
  const cosines = Float64Array.from({ length: half }, (_, index) =>
    Math.cos((-2 * Math.PI * index) / size),
  );
  const sines = Float64Array.from({ length: half }, (_, index) =>
    Math.sin((-2 * Math.PI * index) / size),
  );

  return (re, im) => {
    for (let index = 0; index < size; index += 1) {
      const target = reversed[index];
      if (target > index) {
        const real = re[index];
        re[index] = re[target];
        re[target] = real;
        const imaginary = im[index];
        im[index] = im[target];
        im[target] = imaginary;
      }
    }
    for (let span = 2; span <= size; span <<= 1) {
      const pair = span >> 1;
      const stride = size / span;
      for (let start = 0; start < size; start += span) {
        for (let offset = 0; offset < pair; offset += 1) {
          const cosine = cosines[offset * stride];
          const sine = sines[offset * stride];
          const top = start + offset;
          const bottom = top + pair;
          const real = cosine * re[bottom] - sine * im[bottom];
          const imaginary = cosine * im[bottom] + sine * re[bottom];
          re[bottom] = re[top] - real;
          im[bottom] = im[top] - imaginary;
          re[top] += real;
          im[top] += imaginary;
        }
      }
    }
  };
};

const cpuFfts = new Map<number, CpuFft>();

export const fftInPlace: CpuFft = (re, im) => {
  let fft = cpuFfts.get(re.length);
  if (!fft) {
    fft = createCpuFft(re.length);
    cpuFfts.set(re.length, fft);
  }
  fft(re, im);
};
