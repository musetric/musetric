struct StockhamParams {
  windowSize: u32,
  windowCount: u32,
  stride: u32,
}

@group(0) @binding(0) var<storage, read>            pingReal: array<f32>;
@group(0) @binding(1) var<storage, read>            pingImag: array<f32>;
@group(0) @binding(2) var<storage, read_write>      pongReal: array<f32>;
@group(0) @binding(3) var<storage, read_write>      pongImag: array<f32>;
@group(0) @binding(4) var<storage, read>            trigTable: array<f32>;
@group(0) @binding(5) var<uniform>                  params: StockhamParams;

// 2D dispatch: x = halfN/64 groups (butterflies), y = windowCount (windows).
// Avoids exceeding maxComputeWorkgroupsPerDimension (65535) for large N×windowCount.
@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id)        wgId: vec3<u32>,
  @builtin(local_invocation_id) lid:  vec3<u32>,
) {
  let windowSize = params.windowSize;
  let windowCount = params.windowCount;
  let stride = params.stride;
  let halfN = windowSize >> 1u;

  let windowIdx = wgId.y;
  if (windowIdx >= windowCount) {
    return;
  }

  let j = wgId.x * 64u + lid.x;
  if (j >= halfN) {
    return;
  }

  let windowOffset = windowIdx * windowSize;

  let k     = j % stride;
  let block = j / stride;

  let aIdx    = windowOffset + block * stride + k;
  let bIdx    = aIdx + halfN;
  let outEven = windowOffset + block * (stride << 1u) + k;
  let outOdd  = outEven + stride;

  let trigIdx = k * (halfN / stride);
  let twReal  =  trigTable[2u * trigIdx];
  let twImag  = -trigTable[2u * trigIdx + 1u];

  let aR = pingReal[aIdx];
  let aI = pingImag[aIdx];
  let bR = pingReal[bIdx];
  let bI = pingImag[bIdx];

  let wbR = bR * twReal - bI * twImag;
  let wbI = bR * twImag + bI * twReal;

  pongReal[outEven] = aR + wbR;
  pongImag[outEven] = aI + wbI;
  pongReal[outOdd]  = aR - wbR;
  pongImag[outOdd]  = aI - wbI;
}
