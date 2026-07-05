export const centsDistanceWgsl = `fn centsDistance(frequency: f32, reference: f32) -> f32 {
  if (frequency <= 0.0 || reference <= 0.0) {
    return 100000.0;
  }

  return abs(1200.0 * log2(frequency / reference));
}`;
