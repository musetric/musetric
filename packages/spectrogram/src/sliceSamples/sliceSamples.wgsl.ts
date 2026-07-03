export const shader = `
struct SliceSamplesParams {
  windowSize : u32,
  paddedWindowSize : u32,
  signalStride : u32,
  windowCount : u32,
  visibleSamples : u32,
  step : f32,
  ringStart : u32,
  slotOffset : u32,
  screenBase : u32,
  baseColumn : i32,
  baseWindowStart : i32,
};

@group(0) @binding(0) var<storage, read> samples : array<f32>;
@group(0) @binding(1) var<storage, read_write> signal : array<f32>;
@group(0) @binding(2) var<uniform> params : SliceSamplesParams;
@group(0) @binding(3) var<storage, read> windowFunction : array<f32>;

fn roundToI32(value: f32) -> i32 {
  return i32(floor(value + 0.5));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let windowSize = params.windowSize;
  let paddedWindowSize = params.paddedWindowSize;
  let signalStride = params.signalStride;
  let windowCount = params.windowCount;
  let visibleSamples = params.visibleSamples;
  let step = params.step;

  let sampleIndex = gid.x;
  let localColumn = gid.y;
  if (sampleIndex >= paddedWindowSize) {
    return;
  }

  let screenColumn = params.screenBase + localColumn;
  let slot = (params.slotOffset + localColumn) % windowCount;
  let absoluteColumn = params.baseColumn + i32(screenColumn);
  let windowStart = roundToI32(
    f32(absoluteColumn) * step - f32(windowSize) * 0.5,
  );
  let localOffset = u32(windowStart - params.baseWindowStart);

  var value = 0.0;
  if (sampleIndex < windowSize) {
    let localIndex = localOffset + sampleIndex;
    let ringIndex = (params.ringStart + localIndex) % visibleSamples;
    value = samples[ringIndex] * windowFunction[sampleIndex];
  }
  signal[signalStride * slot + sampleIndex] = value;
}
`;
