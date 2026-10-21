const byteStep = 0x8000;

export const encodeSamples = (samples: Float32Array): string => {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  let text = '';
  for (let index = 0; index < bytes.length; index += byteStep) {
    text += String.fromCharCode(...bytes.subarray(index, index + byteStep));
  }
  return btoa(text);
};

export const joinSamples = (parts: readonly Float32Array[]): Float32Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
};

export const wait = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const epochNow = () => performance.timeOrigin + performance.now();
