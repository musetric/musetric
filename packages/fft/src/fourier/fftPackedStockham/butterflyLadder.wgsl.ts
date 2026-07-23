export const stockhamLadderHelpers = `
fn getFactorCount() -> u32 {
  return radix8StageCount +
    radix4StageCount +
    radix2StageCount +
    radix3StageCount +
    radix5StageCount;
}

fn getFactor(stage: u32) -> u32 {
  if (stage < radix8StageCount) {
    return 8u;
  }
  if (stage < radix8StageCount + radix4StageCount) {
    return 4u;
  }
  if (stage < radix8StageCount + radix4StageCount + radix2StageCount) {
    return 2u;
  }
  if (
    stage <
    radix8StageCount + radix4StageCount + radix2StageCount + radix3StageCount
  ) {
    return 3u;
  }
  return 5u;
}

fn readStage(index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return sm0[index];
  }
  return sm1[index];
}

fn writeStage(index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    sm1[index] = value;
  } else {
    sm0[index] = value;
  }
}

fn getResult(index: u32) -> vec2<f32> {
  if ((getFactorCount() & 1u) == 0u) {
    return sm0[index];
  }
  return sm1[index];
}
`;

export const stockhamLadderStages = `
  for (var stage = firstStage; stage < getFactorCount(); stage++) {
    let factor = getFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = packedWindowSize / factor;
    let twiddleScale = packedWindowSize / (stageStride * factor);

    if (factor == 8u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getTwiddle(2u * tw));
        let a3 = mul(readStage(base + 3u * butterflyCount, readEven),
          getTwiddle(3u * tw));
        let a4 = mul(readStage(base + 4u * butterflyCount, readEven),
          getTwiddle(4u * tw));
        let a5 = mul(readStage(base + 5u * butterflyCount, readEven),
          getTwiddle(5u * tw));
        let a6 = mul(readStage(base + 6u * butterflyCount, readEven),
          getTwiddle(6u * tw));
        let a7 = mul(readStage(base + 7u * butterflyCount, readEven),
          getTwiddle(7u * tw));
        let y = combineRadix8(a0, a1, a2, a3, a4, a5, a6, a7);
        let o0 = block * (stageStride * 8u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        let o4 = o3 + stageStride;
        let o5 = o4 + stageStride;
        let o6 = o5 + stageStride;
        let o7 = o6 + stageStride;
        writeStage(o0, readEven, y[0]);
        writeStage(o1, readEven, y[1]);
        writeStage(o2, readEven, y[2]);
        writeStage(o3, readEven, y[3]);
        writeStage(o4, readEven, y[4]);
        writeStage(o5, readEven, y[5]);
        writeStage(o6, readEven, y[6]);
        writeStage(o7, readEven, y[7]);
      }
    } else if (factor == 2u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let aIndex = block * stageStride + k;
        let bIndex = aIndex + butterflyCount;
        let a0 = readStage(aIndex, readEven);
        let a1 = mul(readStage(bIndex, readEven), getTwiddle(k * twiddleScale));
        let y = combineRadix2(a0, a1);
        let outEven = block * (stageStride * 2u) + k;
        let outOdd = outEven + stageStride;
        writeStage(outEven, readEven, y[0]);
        writeStage(outOdd, readEven, y[1]);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let r0 = block * stageStride + k;
        let a0 = readStage(r0, readEven);
        let a1 = mul(readStage(r0 + butterflyCount, readEven),
          getTwiddle(k * twiddleScale));
        let a2 = mul(readStage(r0 + 2u * butterflyCount, readEven),
          getTwiddle(2u * k * twiddleScale));
        let a3 = mul(readStage(r0 + 3u * butterflyCount, readEven),
          getTwiddle(3u * k * twiddleScale));
        let y = combineRadix4(a0, a1, a2, a3);
        let o0 = block * (stageStride * 4u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        writeStage(o0, readEven, y[0]);
        writeStage(o1, readEven, y[1]);
        writeStage(o2, readEven, y[2]);
        writeStage(o3, readEven, y[3]);
      }
    } else if (factor == 3u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getTwiddle(2u * tw));
        let y = combineRadix3(a0, a1, a2);
        let o0 = block * (stageStride * 3u) + k;
        writeStage(o0, readEven, y[0]);
        writeStage(o0 + stageStride, readEven, y[1]);
        writeStage(o0 + 2u * stageStride, readEven, y[2]);
      }
    } else if (factor == 5u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getTwiddle(2u * tw));
        let a3 = mul(readStage(base + 3u * butterflyCount, readEven),
          getTwiddle(3u * tw));
        let a4 = mul(readStage(base + 4u * butterflyCount, readEven),
          getTwiddle(4u * tw));
        let y = combineRadix5(a0, a1, a2, a3, a4);
        let o0 = block * (stageStride * 5u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        let o4 = o3 + stageStride;
        writeStage(o0, readEven, y[0]);
        writeStage(o1, readEven, y[1]);
        writeStage(o2, readEven, y[2]);
        writeStage(o3, readEven, y[3]);
        writeStage(o4, readEven, y[4]);
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputIndex = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (packedWindowSize / factor))) %
              packedWindowSize;
            var value = readStage(inputIndex, readEven);
            value = mul(value, getTwiddle(twiddleIndex));
            sum += value;
          }
          let outputIndex =
            block * (stageStride * factor) + r * stageStride + k;
          writeStage(outputIndex, readEven, sum);
        }
      }
    }

    stageStride *= factor;
    workgroupBarrier();
  }
`;

export const stockhamCombines = `
const sqrt1_2: f32 = 0.70710678118654752440;
const sin3: f32 = 0.86602540378443864676;
const cos5a: f32 = 0.30901699437494742410;
const cos5b: f32 = -0.80901699437494742410;
const sin5a: f32 = 0.95105651629515357212;
const sin5b: f32 = 0.58778525229247312917;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(
    fftTrigTable[2u * index],
    twiddleSign * fftTrigTable[2u * index + 1u],
  );
}

fn jmul(v: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(-twiddleSign * v.y, twiddleSign * v.x);
}

fn combineRadix2(a0: vec2<f32>, a1: vec2<f32>) -> array<vec2<f32>, 2> {
  return array<vec2<f32>, 2>(a0 + a1, a0 - a1);
}

fn combineRadix3(
  a0: vec2<f32>,
  a1: vec2<f32>,
  a2: vec2<f32>,
) -> array<vec2<f32>, 3> {
  let t1 = a1 + a2;
  let m = a0 - 0.5 * t1;
  let d = a2 - a1;
  let ids = -sin3 * jmul(d);
  return array<vec2<f32>, 3>(a0 + t1, m + ids, m - ids);
}

fn combineRadix4(
  a0: vec2<f32>,
  a1: vec2<f32>,
  a2: vec2<f32>,
  a3: vec2<f32>,
) -> array<vec2<f32>, 4> {
  let sum02 = a0 + a2;
  let diff02 = a0 - a2;
  let sum13 = a1 + a3;
  let diff13 = a1 - a3;
  let jd = jmul(diff13);
  return array<vec2<f32>, 4>(
    sum02 + sum13,
    diff02 + jd,
    sum02 - sum13,
    diff02 - jd,
  );
}

fn combineRadix5(
  a0: vec2<f32>,
  a1: vec2<f32>,
  a2: vec2<f32>,
  a3: vec2<f32>,
  a4: vec2<f32>,
) -> array<vec2<f32>, 5> {
  let t1 = a1 + a4;
  let t2 = a2 + a3;
  let t3 = a1 - a4;
  let t4 = a2 - a3;
  let b1 = a0 + cos5a * t1 + cos5b * t2;
  let b2 = a0 + cos5b * t1 + cos5a * t2;
  let b3 = sin5a * t3 + sin5b * t4;
  let b4 = sin5b * t3 - sin5a * t4;
  let jb3 = jmul(b3);
  let jb4 = jmul(b4);
  return array<vec2<f32>, 5>(
    a0 + t1 + t2,
    b1 + jb3,
    b2 + jb4,
    b2 - jb4,
    b1 - jb3,
  );
}

fn combineRadix8(
  a0: vec2<f32>,
  a1: vec2<f32>,
  a2: vec2<f32>,
  a3: vec2<f32>,
  a4: vec2<f32>,
  a5: vec2<f32>,
  a6: vec2<f32>,
  a7: vec2<f32>,
) -> array<vec2<f32>, 8> {
  let e0 = a0 + a4;
  let e1 = a0 - a4;
  let e2 = a2 + a6;
  let e3 = a2 - a6;
  let je3 = jmul(e3);
  let E0 = e0 + e2;
  let E1 = e1 + je3;
  let E2 = e0 - e2;
  let E3 = e1 - je3;
  let f0 = a1 + a5;
  let f1 = a1 - a5;
  let f2 = a3 + a7;
  let f3 = a3 - a7;
  let jf3 = jmul(f3);
  let O0 = f0 + f2;
  let O1 = f1 + jf3;
  let O2 = f0 - f2;
  let O3 = f1 - jf3;
  let p0 = O0;
  let p1 = mul(O1, vec2<f32>(sqrt1_2, twiddleSign * sqrt1_2));
  let p2 = jmul(O2);
  let p3 = mul(O3, vec2<f32>(-sqrt1_2, twiddleSign * sqrt1_2));
  return array<vec2<f32>, 8>(
    E0 + p0,
    E1 + p1,
    E2 + p2,
    E3 + p3,
    E0 - p0,
    E1 - p1,
    E2 - p2,
    E3 - p3,
  );
}
`;
