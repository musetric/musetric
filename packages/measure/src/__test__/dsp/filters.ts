type Complex = {
  re: number;
  im: number;
};

const add = (a: Complex, b: Complex): Complex => ({
  re: a.re + b.re,
  im: a.im + b.im,
});

const subtract = (a: Complex, b: Complex): Complex => ({
  re: a.re - b.re,
  im: a.im - b.im,
});

const multiply = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

const divide = (a: Complex, b: Complex): Complex => {
  const norm = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / norm,
    im: (a.im * b.re - a.re * b.im) / norm,
  };
};

const squareRoot = (value: Complex): Complex => {
  const magnitude = Math.hypot(value.re, value.im);
  const re = Math.sqrt((magnitude + value.re) / 2);
  const im = Math.sqrt((magnitude - value.re) / 2);
  return { re, im: value.im < 0 ? -im : im };
};

const real = (value: number): Complex => ({ re: value, im: 0 });

const butterworthOrder = 4;
const bilinearScale = 4;

const getPrototypePoles = (): Complex[] =>
  Array.from({ length: butterworthOrder }, (_, index) => {
    const angle =
      (Math.PI * (2 * index - butterworthOrder + 1)) / (2 * butterworthOrder);
    return { re: -Math.cos(angle), im: -Math.sin(angle) };
  });

const warp = (frequency: number, sampleRate: number) =>
  bilinearScale * Math.tan((Math.PI * frequency) / sampleRate);

export type SecondOrderSection = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export const designButterworthBandPass = (
  lowFrequency: number,
  highFrequency: number,
  sampleRate: number,
): SecondOrderSection[] => {
  const low = warp(lowFrequency, sampleRate);
  const high = warp(highFrequency, sampleRate);
  const center = real(low * high);
  const width = high - low;
  const analogPoles = getPrototypePoles().flatMap((pole) => {
    const shifted = multiply(pole, real(width / 2));
    const offset = squareRoot(subtract(multiply(shifted, shifted), center));
    return [add(shifted, offset), subtract(shifted, offset)];
  });
  const scale = real(bilinearScale);
  let gain = real(width ** butterworthOrder * scale.re ** butterworthOrder);
  for (const pole of analogPoles) {
    gain = divide(gain, subtract(scale, pole));
  }
  const digitalPoles = analogPoles
    .map((pole) => divide(add(scale, pole), subtract(scale, pole)))
    .filter((pole) => pole.im > 0);
  return digitalPoles.map((pole, index) => {
    const numerator = index === 0 ? gain.re : 1;
    return {
      b0: numerator,
      b1: 0,
      b2: -numerator,
      a1: -2 * pole.re,
      a2: pole.re * pole.re + pole.im * pole.im,
    };
  });
};

export const filterSections = (
  samples: ArrayLike<number>,
  sections: readonly SecondOrderSection[],
): Float64Array => {
  const output = Float64Array.from(samples);
  for (const section of sections) {
    let first = 0;
    let second = 0;
    for (let index = 0; index < output.length; index += 1) {
      const input = output[index];
      const value = section.b0 * input + first;
      first = section.b1 * input - section.a1 * value + second;
      second = section.b2 * input - section.a2 * value;
      output[index] = value;
    }
  }
  return output;
};

export const getSectionsResponse = (
  sections: readonly SecondOrderSection[],
  frequency: number,
  sampleRate: number,
): number => {
  const angle = (2 * Math.PI * frequency) / sampleRate;
  const inverse = { re: Math.cos(angle), im: -Math.sin(angle) };
  const inverseSquared = multiply(inverse, inverse);
  let response = real(1);
  for (const section of sections) {
    const numerator = add(
      add(real(section.b0), multiply(real(section.b1), inverse)),
      multiply(real(section.b2), inverseSquared),
    );
    const denominator = add(
      add(real(1), multiply(real(section.a1), inverse)),
      multiply(real(section.a2), inverseSquared),
    );
    response = multiply(response, divide(numerator, denominator));
  }
  return Math.hypot(response.re, response.im);
};
