// Pipeline-overridable constants baked in at pipeline creation.
// windowSize * 16 bytes of shared memory required (4 f32 arrays).
override windowSize: u32 = 1024;
override log2Size:   u32 = 10;

// Ping (sm0) and pong (sm1) in shared memory — stages alternate between them.
var<workgroup> smReal0: array<f32, windowSize>;
var<workgroup> smImag0: array<f32, windowSize>;
var<workgroup> smReal1: array<f32, windowSize>;
var<workgroup> smImag1: array<f32, windowSize>;

@group(0) @binding(0) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(2) var<storage, read>        trigTable:  array<f32>;

// One workgroup per window. 64 threads each handle windowSize/2/64 butterflies per stage.
// All stages run inside this single dispatch — no round-trips to VRAM between stages.
@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id)       wgId: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let windowOffset = wgId.x * windowSize;
  let t = lid.x;

  // Load global → shared (sm0 = initial ping)
  for (var i = t; i < windowSize; i += 64u) {
    smReal0[i] = signalReal[windowOffset + i];
    smImag0[i] = signalImag[windowOffset + i];
  }
  workgroupBarrier();

  let halfN = windowSize >> 1u;

  for (var s: u32 = 0u; s < log2Size; s++) {
    let stride    = 1u << s;
    let evenStage = (s & 1u) == 0u;

    for (var j = t; j < halfN; j += 64u) {
      let k     = j % stride;
      let block = j / stride;

      let aIdx    = block * stride + k;
      let bIdx    = aIdx + halfN;
      let outEven = block * (stride << 1u) + k;
      let outOdd  = outEven + stride;

      // Twiddle W = exp(-2πi·k / (2·stride)), looked up from precomputed table.
      let trigIdx = k * (halfN / stride);
      let twReal  =  trigTable[2u * trigIdx];
      let twImag  = -trigTable[2u * trigIdx + 1u];

      var aR: f32; var aI: f32; var bR: f32; var bI: f32;
      if (evenStage) {
        aR = smReal0[aIdx]; aI = smImag0[aIdx];
        bR = smReal0[bIdx]; bI = smImag0[bIdx];
      } else {
        aR = smReal1[aIdx]; aI = smImag1[aIdx];
        bR = smReal1[bIdx]; bI = smImag1[bIdx];
      }

      let wbR = bR * twReal - bI * twImag;
      let wbI = bR * twImag + bI * twReal;

      if (evenStage) {
        smReal1[outEven] = aR + wbR; smImag1[outEven] = aI + wbI;
        smReal1[outOdd]  = aR - wbR; smImag1[outOdd]  = aI - wbI;
      } else {
        smReal0[outEven] = aR + wbR; smImag0[outEven] = aI + wbI;
        smReal0[outOdd]  = aR - wbR; smImag0[outOdd]  = aI - wbI;
      }
    }
    workgroupBarrier();
  }

  // Result lands in sm0 when log2Size is even (last stage index is odd → wrote sm0),
  // in sm1 when log2Size is odd (last stage index is even → wrote sm1).
  let resultInSm0 = (log2Size & 1u) == 0u;
  for (var i = t; i < windowSize; i += 64u) {
    var outR: f32;
    var outI: f32;
    if (resultInSm0) {
      outR = smReal0[i]; outI = smImag0[i];
    } else {
      outR = smReal1[i]; outI = smImag1[i];
    }
    signalReal[windowOffset + i] = outR;
    signalImag[windowOffset + i] = outI;
  }
}
