struct DrawParams {
  foreground : vec4f,
  background : vec4f,
  primary : vec4f,
  frequencyMap : vec4f,
  recordingMatchColor : vec4f,
  recordingCloseColor : vec4f,
  recordingMissColor : vec4f,
  recordingThresholds : vec4f,
  visibility : vec4u,
  relation : vec4u,
};

@group(0) @binding(0) var<uniform> drawParams : DrawParams;
@group(0) @binding(1) var valueSampler : sampler;
@group(0) @binding(2) var spectrogramTextures : texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> leadFundamentalFrequencies : array<f32>;
@group(0) @binding(4) var<storage, read> recordingFundamentalFrequencies : array<f32>;

fn frequencyAtPixel(pixelY: u32, height: f32) -> f32 {
  let ratio = 1.0 - f32(pixelY) / max(1.0, height - 1.0);
  return exp(drawParams.frequencyMap.x + drawParams.frequencyMap.y * ratio);
}

fn pixelYAtFrequency(frequency: f32, height: f32) -> f32 {
  let ratio = (log(frequency) - drawParams.frequencyMap.x) /
    drawParams.frequencyMap.y;
  return (1.0 - ratio) * max(1.0, height - 1.0);
}

fn centsDistance(frequency: f32, centerFrequency: f32) -> f32 {
  if (frequency <= 0.0 || centerFrequency <= 0.0) {
    return 100000.0;
  }

  return abs(1200.0 * log2(frequency / centerFrequency));
}

fn distanceToSegment(point: vec2f, start: vec2f, end: vec2f) -> f32 {
  let offset = point - start;
  let segment = end - start;
  let segmentLength = dot(segment, segment);
  if (segmentLength <= 0.000001) {
    return length(offset);
  }

  let amount = clamp(dot(offset, segment) / segmentLength, 0.0, 1.0);
  return length(offset - segment * amount);
}

fn segmentLineMask(
  point: vec2f,
  height: f32,
  startIndex: u32,
  startFrequency: f32,
  endIndex: u32,
  endFrequency: f32,
  widthCents: f32,
) -> f32 {
  if (
    startFrequency <= 0.0 ||
    endFrequency <= 0.0 ||
    centsDistance(startFrequency, endFrequency) > 720.0
  ) {
    return 0.0;
  }

  let centsPerPixel = 1200.0 * drawParams.frequencyMap.y /
    (log(2.0) * max(1.0, height - 1.0));
  let widthPixels = max(1.0, widthCents / centsPerPixel);
  let start = vec2f(
    f32(startIndex) + 0.5,
    pixelYAtFrequency(startFrequency, height),
  );
  let end = vec2f(f32(endIndex) + 0.5, pixelYAtFrequency(endFrequency, height));
  let normalizedDistance = distanceToSegment(point, start, end) / widthPixels;
  return exp(-0.5 * normalizedDistance * normalizedDistance);
}

fn recordingLineColor(referenceFreq: f32, recordedFreq: f32) -> vec3f {
  let distance = centsDistance(referenceFreq, recordedFreq);
  let matchThreshold = drawParams.recordingThresholds.x;
  let closeThreshold = drawParams.recordingThresholds.y;
  if (distance <= matchThreshold) {
    return drawParams.recordingMatchColor.xyz;
  }
  if (distance >= closeThreshold) {
    return drawParams.recordingMissColor.xyz;
  }
  let blend = (distance - matchThreshold) / (closeThreshold - matchThreshold);
  return mix(
    drawParams.recordingMatchColor.xyz,
    drawParams.recordingCloseColor.xyz,
    blend,
  );
}

fn lineMaskAtPixel(
  point: vec2f,
  width: u32,
  height: f32,
  x: u32,
  centerFrequency: f32,
  previousFrequency: f32,
  nextFrequency: f32,
  widthCents: f32,
) -> f32 {
  if (centerFrequency <= 0.0) {
    return 0.0;
  }

  let frequency = frequencyAtPixel(u32(point.y), height);
  let distance = centsDistance(frequency, centerFrequency);
  let normalizedDistance = distance / widthCents;
  var mask = clamp(
    exp(-0.5 * normalizedDistance * normalizedDistance) * 1.18,
    0.0,
    1.0,
  );
  if (x > 0u && previousFrequency > 0.0) {
    mask = max(
      mask,
      segmentLineMask(
        point,
        height,
        x - 1u,
        previousFrequency,
        x,
        centerFrequency,
        widthCents,
      ),
    );
  }
  if (x + 1u < width && nextFrequency > 0.0) {
    mask = max(
      mask,
      segmentLineMask(
        point,
        height,
        x,
        centerFrequency,
        x + 1u,
        nextFrequency,
        widthCents,
      ),
    );
  }
  return mask;
}

@fragment
fn main(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = textureDimensions(spectrogramTextures);
  let width = dimensions.x;
  let height = f32(dimensions.y);
  let x = min(u32(position.x), width - 1u);
  let sampleUv = vec2f(uv.x, 1.0 - uv.y);

  var intensity = 0.0;
  if (drawParams.visibility.x != 0u) {
    intensity = max(
      intensity,
      textureSample(spectrogramTextures, valueSampler, sampleUv, 0).r,
    );
  }
  if (drawParams.visibility.y != 0u) {
    intensity = max(
      intensity,
      textureSample(spectrogramTextures, valueSampler, sampleUv, 1).r,
    );
  }
  let baseColor = mix(
    drawParams.background.xyz,
    drawParams.foreground.xyz,
    intensity,
  );

  var leadMask = 0.0;
  let leadVisible = drawParams.visibility.z != 0u;
  if (leadVisible) {
    let leadCenter = leadFundamentalFrequencies[x];
    var leadPrev = 0.0;
    if (x > 0u) {
      leadPrev = leadFundamentalFrequencies[x - 1u];
    }
    var leadNext = 0.0;
    if (x + 1u < width) {
      leadNext = leadFundamentalFrequencies[x + 1u];
    }
    leadMask = lineMaskAtPixel(
      position.xy,
      width,
      height,
      x,
      leadCenter,
      leadPrev,
      leadNext,
      26.0,
    );
  }

  var recordingMask = 0.0;
  var recordingFreq = 0.0;
  let recordingVisible = drawParams.visibility.w != 0u;
  let recordingWidth = drawParams.recordingThresholds.z;
  if (recordingVisible) {
    recordingFreq = recordingFundamentalFrequencies[x];
    var recordingPrev = 0.0;
    if (x > 0u) {
      recordingPrev = recordingFundamentalFrequencies[x - 1u];
    }
    var recordingNext = 0.0;
    if (x + 1u < width) {
      recordingNext = recordingFundamentalFrequencies[x + 1u];
    }
    recordingMask = lineMaskAtPixel(
      position.xy,
      width,
      height,
      x,
      recordingFreq,
      recordingPrev,
      recordingNext,
      recordingWidth,
    );
  }

  let leadLineColor = mix(drawParams.primary.xyz, vec3f(0.0), 0.12);
  var color = mix(baseColor, leadLineColor, leadMask);

  if (recordingMask > 0.0) {
    var recColor = drawParams.recordingMissColor.xyz;
    if (leadVisible) {
      let referenceFreq = leadFundamentalFrequencies[x];
      if (referenceFreq > 0.0) {
        recColor = recordingLineColor(referenceFreq, recordingFreq);
      }
    }
    color = mix(color, recColor, recordingMask);
  }

  return vec4f(color, 1.0);
}
