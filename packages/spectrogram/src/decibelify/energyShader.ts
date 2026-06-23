export const energyShader = `
struct DecibelifyParams {
  halfSize: u32,
  windowCount: u32,
  decibelFactor: f32,
  gain: f32,
  gateFloorDb: f32,
  gateRangeDb: f32,
};

@group(0) @binding(0) var<storage, read_write> signal: array<f32>;
@group(0) @binding(1) var<uniform> params: DecibelifyParams;
@group(0) @binding(2) var<storage, read_write> columnEnergy: array<f32>;

var<workgroup> localSums: array<f32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) workgroupId: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let halfSize = params.halfSize;
  let windowCount = params.windowCount;
  let windowIndex = workgroupId.x;
  let workerId = lid.x;
  if (windowIndex >= windowCount) {
    return;
  }

  let windowOffset = halfSize * windowIndex;
  let chunkSize = (halfSize + 63u) / 64u;
  let chunkStart = chunkSize * workerId;
  let chunkEnd = min(chunkStart + chunkSize, halfSize);

  var sumSquares = 0.0;
  for (var i = chunkStart; i < chunkEnd; i += 1u) {
    let value = signal[windowOffset + i];
    sumSquares += value * value;
  }

  localSums[workerId] = sumSquares;

  workgroupBarrier();

  if (workerId == 0u) {
    var totalSumSquares = 0.0;
    for (var i = 0u; i < 64u; i += 1u) {
      totalSumSquares += localSums[i];
    }
    columnEnergy[windowIndex] = sqrt(totalSumSquares / f32(halfSize));
  }
}
`;
