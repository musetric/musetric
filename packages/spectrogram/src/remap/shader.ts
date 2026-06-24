const createSpectrumBindings = (spectrumCount: number) =>
  Array.from({ length: spectrumCount }, (_, index) => {
    const rawMagnitudeBinding = 2 + index * 2;
    const columnEnergyBinding = rawMagnitudeBinding + 1;
    return [
      `@group(0) @binding(${rawMagnitudeBinding}) var<storage, read> rawMagnitude${index}: array<f32>;`,
      `@group(0) @binding(${columnEnergyBinding}) var<storage, read> columnEnergy${index}: array<f32>;`,
    ].join('\n');
  }).join('\n');

const createSpectrumSampling = (spectrumCount: number) =>
  Array.from({ length: spectrumCount }, (_, index) => {
    const paramsIndex = index * 2;
    return `
  let band${index}a = params.bands[${paramsIndex}];
  let band${index}b = params.bands[${paramsIndex + 1}];
  let windowSize${index} = band${index}a.x;
  let halfSize${index} = band${index}a.y;
  let rawIndex${index} = (frequency / sampleRate) * windowSize${index};
  let clampedIndex${index} = clamp(rawIndex${index}, 0.0, halfSize${index} - 1.0);
  let lowerIndex${index} = u32(floor(clampedIndex${index}));
  let upperIndex${index} = min(lowerIndex${index} + 1u, u32(halfSize${index} - 1.0));
  let blend${index} = fract(clampedIndex${index});
  let offset${index} = x * u32(halfSize${index});
  let lowerMagnitude${index} = rawMagnitude${index}[offset${index} + lowerIndex${index}];
  let upperMagnitude${index} = rawMagnitude${index}[offset${index} + upperIndex${index}];
  let magnitude${index} = mix(lowerMagnitude${index}, upperMagnitude${index}, blend${index});
  let intensity${index} = displayIntensity(
    magnitude${index},
    columnEnergy${index}[x],
    halfSize${index},
    gain,
    decibelFactor,
  );
  let weight${index} = bandWeight(
    frequency,
    band${index}a.z,
    band${index}a.w,
    band${index}b.x,
    band${index}b.y,
  );
  weightedIntensity += intensity${index} * weight${index};
  totalWeight += weight${index};
`;
  }).join('\n');

export const createShader = (spectrumCount: number) => `
struct RemapParams {
  width: u32,
  height: u32,
  sampleRate: f32,
  logMinFrequency: f32,
  logFrequencyRange: f32,
  decibelFactor: f32,
  gain: f32,
  gateFloorDb: f32,
  gateRangeDb: f32,
  frequencyTiltSlope: f32,
  frequencyTiltMinGain: f32,
  frequencyTiltMaxGain: f32,
  displayGamma: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
  bands: array<vec4f, ${spectrumCount * 2}>,
};

@group(0) @binding(0) var texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params: RemapParams;
${createSpectrumBindings(spectrumCount)}

fn displayFrequencyTilt(frequency: f32) -> f32 {
  let anchorFrequency = 440.0;
  return clamp(
    pow(frequency / anchorFrequency, params.frequencyTiltSlope),
    params.frequencyTiltMinGain,
    params.frequencyTiltMaxGain,
  );
}

fn risingWeight(frequency: f32, startFrequency: f32, fullFrequency: f32) -> f32 {
  if (fullFrequency <= startFrequency) {
    if (frequency >= fullFrequency) {
      return 1.0;
    }
    return 0.0;
  }
  return smoothstep(startFrequency, fullFrequency, frequency);
}

fn fallingWeight(frequency: f32, fullFrequency: f32, endFrequency: f32) -> f32 {
  if (endFrequency <= fullFrequency) {
    if (frequency <= fullFrequency) {
      return 1.0;
    }
    return 0.0;
  }
  return 1.0 - smoothstep(fullFrequency, endFrequency, frequency);
}

fn bandWeight(
  frequency: f32,
  minFrequency: f32,
  fullMinFrequency: f32,
  fullMaxFrequency: f32,
  maxFrequency: f32,
) -> f32 {
  return
    risingWeight(frequency, minFrequency, fullMinFrequency) *
    fallingWeight(frequency, fullMaxFrequency, maxFrequency);
}

fn displayIntensity(
  magnitude: f32,
  energy: f32,
  halfSize: f32,
  gain: f32,
  decibelFactor: f32,
) -> f32 {
  let referenceMagnitude = sqrt(halfSize);
  let epsilon = 1e-12;
  let normalizedMagnitude = magnitude * gain / referenceMagnitude + epsilon;
  let normalizedEnergy = energy * gain / referenceMagnitude + epsilon;
  let energyDb = log(normalizedEnergy) * 8.685889638;
  let gate = clamp(
    (energyDb - params.gateFloorDb) / params.gateRangeDb,
    0.0,
    1.0,
  );
  let decibel = max(log(normalizedMagnitude) * decibelFactor + 1.0, 0.0);
  return decibel * gate;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let width = params.width;
  let height = params.height;
  let sampleRate = params.sampleRate;
  let logMinFrequency = params.logMinFrequency;
  let logFrequencyRange = params.logFrequencyRange;
  let decibelFactor = params.decibelFactor;
  let gain = params.gain;
  
  let x = gid.x;
  let y = gid.y;
  if (x >= width || y >= height) {
    return;
  }
  let ratio = 1.0 - f32(y) / f32(height - 1u);
  let frequency = exp(logMinFrequency + logFrequencyRange * ratio);
  var weightedIntensity = 0.0;
  var totalWeight = 0.0;
${createSpectrumSampling(spectrumCount)}
  let mixedDisplayIntensity = weightedIntensity / max(totalWeight, 1e-6);
  let tiltedIntensity = clamp(
    mixedDisplayIntensity * displayFrequencyTilt(frequency),
    0.0,
    1.0,
  );
  let intensity = pow(tiltedIntensity, max(params.displayGamma, 0.001));
  textureStore(texture, vec2u(x, y), vec4f(intensity, 0.0, 0.0, 1.0));
}
`;
