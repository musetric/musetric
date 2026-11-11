import { peakOf } from '../separation/separationStems.js';

export const readStreamPeak = async (
  stream: ReadableStream<Uint8Array>,
): Promise<number> => {
  const reader = stream.getReader();
  const carry = new Uint8Array(Float32Array.BYTES_PER_ELEMENT);
  let carried = 0;
  let peak = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      return peak;
    }
    const taken = Math.min(
      (Float32Array.BYTES_PER_ELEMENT - carried) %
        Float32Array.BYTES_PER_ELEMENT,
      read.value.length,
    );
    carry.set(read.value.subarray(0, taken), carried);
    carried += taken;
    if (carried === Float32Array.BYTES_PER_ELEMENT) {
      peak = Math.max(peak, peakOf(new Float32Array(carry.buffer)));
      carried = 0;
    }
    const rest = read.value.subarray(taken);
    const aligned =
      rest.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
        ? rest
        : rest.slice();
    const whole =
      aligned.length - (aligned.length % Float32Array.BYTES_PER_ELEMENT);
    peak = Math.max(
      peak,
      peakOf(
        new Float32Array(
          aligned.buffer,
          aligned.byteOffset,
          whole / Float32Array.BYTES_PER_ELEMENT,
        ),
      ),
    );
    carry.set(aligned.subarray(whole), carried);
    carried += aligned.length - whole;
  }
};
