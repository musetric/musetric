const reverseBits = (re: Float64Array, im: Float64Array) => {
  const size = re.length;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) {
      reversed ^= bit;
    }
    reversed ^= bit;
    if (index < reversed) {
      [re[index], re[reversed]] = [re[reversed], re[index]];
      [im[index], im[reversed]] = [im[reversed], im[index]];
    }
  }
};

export const transformInPlace = (
  re: Float64Array,
  im: Float64Array,
  direction: 1 | -1,
) => {
  const size = re.length;
  reverseBits(re, im);
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (direction * -2 * Math.PI) / length;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    const half = length >> 1;
    for (let start = 0; start < size; start += length) {
      let twiddleRe = 1;
      let twiddleIm = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddRe = re[odd] * twiddleRe - im[odd] * twiddleIm;
        const oddIm = re[odd] * twiddleIm + im[odd] * twiddleRe;
        re[odd] = re[even] - oddRe;
        im[odd] = im[even] - oddIm;
        re[even] += oddRe;
        im[even] += oddIm;
        const nextRe = twiddleRe * stepRe - twiddleIm * stepIm;
        twiddleIm = twiddleRe * stepIm + twiddleIm * stepRe;
        twiddleRe = nextRe;
      }
    }
  }
  if (direction === -1) {
    for (let index = 0; index < size; index += 1) {
      re[index] /= size;
      im[index] /= size;
    }
  }
};
