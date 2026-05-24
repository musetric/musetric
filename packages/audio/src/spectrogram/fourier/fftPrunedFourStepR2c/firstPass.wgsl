override packedWindowSize: u32 = 4096u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override columnSize: u32 = 64u;
override log2RowSize: u32 = 6u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, 64>;
var<workgroup> smImag0: array<f32, 64>;
var<workgroup> smReal1: array<f32, 64>;
var<workgroup> smImag1: array<f32, 64>;

@group(0) @binding(0) var<storage, read> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> scratch: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> fft64TrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn runFft64(t: u32) {
  for (var stage: u32 = 0u; stage < log2RowSize; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    if (t < rowHalfSize) {
      let k = t % stride;
      let block = t / stride;
      let aIndex = block * stride + k;
      let bIndex = aIndex + rowHalfSize;
      let outEven = block * (stride << 1u) + k;
      let outOdd = outEven + stride;
      let trigIndex = k * (rowHalfSize / stride);
      let twiddleReal = fft64TrigTable[2u * trigIndex];
      let twiddleImag = -fft64TrigTable[2u * trigIndex + 1u];

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      if (evenStage) {
        aReal = smReal0[aIndex];
        aImag = smImag0[aIndex];
        bReal = smReal0[bIndex];
        bImag = smImag0[bIndex];
      } else {
        aReal = smReal1[aIndex];
        aImag = smImag1[aIndex];
        bReal = smReal1[bIndex];
        bImag = smImag1[bIndex];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;

      if (evenStage) {
        smReal1[outEven] = aReal + productReal;
        smImag1[outEven] = aImag + productImag;
        smReal1[outOdd] = aReal - productReal;
        smImag1[outOdd] = aImag - productImag;
      } else {
        smReal0[outEven] = aReal + productReal;
        smImag0[outEven] = aImag + productImag;
        smReal0[outOdd] = aReal - productReal;
        smImag0[outOdd] = aImag - productImag;
      }
    }
    workgroupBarrier();
  }
}

fn getRowResultReal(index: u32) -> f32 {
  if ((log2RowSize & 1u) == 0u) {
    return smReal0[index];
  }
  return smReal1[index];
}

fn getRowResultImag(index: u32) -> f32 {
  if ((log2RowSize & 1u) == 0u) {
    return smImag0[index];
  }
  return smImag1[index];
}

@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let n1 = workgroupId.x;
  let windowIndex = workgroupId.y;
  if (n1 >= columnSize || windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let packedIndex = t * columnSize + n1;
  let sampleIndex = packedIndex * 2u;
  let windowOffset = params.windowSize * windowIndex;

  var real = 0.0;
  var imag = 0.0;
  if (sampleIndex < params.windowSize) {
    real = signalReal[windowOffset + sampleIndex];
  }
  if (sampleIndex + 1u < params.windowSize) {
    imag = signalReal[windowOffset + sampleIndex + 1u];
  }

  if (t < rowSize) {
    smReal0[t] = real;
    smImag0[t] = imag;
  }
  workgroupBarrier();

  runFft64(t);

  if (t >= rowSize) {
    return;
  }

  let twiddleIndex = t * columnSize + n1;
  let twiddleReal = fourStepTrigTable[2u * twiddleIndex];
  let twiddleImag = -fourStepTrigTable[2u * twiddleIndex + 1u];
  let outReal = getRowResultReal(t);
  let outImag = getRowResultImag(t);
  let productReal = outReal * twiddleReal - outImag * twiddleImag;
  let productImag = outReal * twiddleImag + outImag * twiddleReal;
  let scratchOffset = packedWindowSize * windowIndex;
  let scratchIndex = scratchOffset + t * columnSize + n1;

  scratch[scratchIndex] = vec2<f32>(productReal, productImag);
}
