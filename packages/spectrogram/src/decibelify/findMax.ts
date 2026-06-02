export const findMaxShader = `
struct DecibelifyParams {
  halfSize: u32,
  windowCount: u32,
  decibelFactor: f32,
};

@group(0) @binding(0) var<storage, read_write> signal: array<f32>;
@group(0) @binding(1) var<uniform> params: DecibelifyParams;

var<workgroup> localMaxValues: array<f32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) workgroupId: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let halfSize = params.halfSize;
  let windowCount = params.windowCount;
  
  let windowIndex = workgroupId.x;
  let workerId = lid.x;
  let windowOffset = halfSize * windowIndex;
  let chunkSize = (halfSize + 63u) / 64u;
  let chunkStart = chunkSize * workerId;
  let chunkEnd = min(chunkStart + chunkSize, halfSize);
  
  var maxMagnitude: f32 = sqrt(f32(halfSize));
  for (var i: u32 = chunkStart; i < chunkEnd; i += 1u) {
    let value = signal[windowOffset + i];
    if (value > maxMagnitude) {
      maxMagnitude = value;
    }
  }
  
  localMaxValues[workerId] = maxMagnitude;
  
  workgroupBarrier();
  
  if (workerId == 0u) {
      var globalMax: f32 = sqrt(f32(halfSize));
      for (var i: u32 = 0u; i < 64u; i += 1u) {
        if (localMaxValues[i] > globalMax) {
          globalMax = localMaxValues[i];
        }
      }
      let maxMagnitudeIndex = halfSize * windowCount + windowIndex;
      signal[maxMagnitudeIndex] = globalMax;
    }
  }
`;
