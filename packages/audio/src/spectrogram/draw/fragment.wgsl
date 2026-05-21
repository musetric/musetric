struct DrawParams {
  foreground : vec4f,
  background : vec4f,
  primary : vec4f,
  frequencyMap : vec4f,
};

@group(0) @binding(0) var<uniform> drawParams : DrawParams;
@group(0) @binding(1) var valueSampler : sampler;
@group(0) @binding(2) var columnTexture : texture_2d<f32>;
@group(0) @binding(3) var<storage, read> fundamentalFrequencies : array<f32>;

fn frequencyAtPixel(pixelY: u32) -> f32 {
  let height = f32(textureDimensions(columnTexture).y);
  let ratio = 1.0 - f32(pixelY) / max(1.0, height - 1.0);
  return exp(drawParams.frequencyMap.x + drawParams.frequencyMap.y * ratio);
}

fn pixelYAtFrequency(frequency: f32) -> f32 {
  let height = f32(textureDimensions(columnTexture).y);
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

  let height = f32(textureDimensions(columnTexture).y);
  let centsPerPixel = 1200.0 * drawParams.frequencyMap.y /
    (log(2.0) * max(1.0, height - 1.0));
  let widthPixels = max(1.0, widthCents / centsPerPixel);
  let start = vec2f(
    f32(startIndex) + 0.5,
    pixelYAtFrequency(startFrequency),
  );
  let end = vec2f(f32(endIndex) + 0.5, pixelYAtFrequency(endFrequency));
  let normalizedDistance = distanceToSegment(point, start, end) / widthPixels;
  return exp(-0.5 * normalizedDistance * normalizedDistance);
}

@fragment
fn main(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> @location(0) vec4f {
  let intensity = textureSample(columnTexture, valueSampler, vec2f(uv.x, 1.0 - uv.y)).r;
  let baseColor = mix(drawParams.background.xyz, drawParams.foreground.xyz, intensity);
  let dimensions = textureDimensions(columnTexture);
  let x = min(u32(position.x), dimensions.x - 1u);
  let y = min(u32(position.y), dimensions.y - 1u);
  let frequency = frequencyAtPixel(y);
  let centerFrequency = fundamentalFrequencies[x];
  let distance = centsDistance(frequency, centerFrequency);
  let normalizedDistance = distance / 26.0;
  let lineMask = clamp(
    exp(-0.5 * normalizedDistance * normalizedDistance) * 1.18,
    0.0,
    1.0,
  );
  let point = position.xy;
  var previousMask = 0.0;
  if (x > 0u) {
    previousMask = segmentLineMask(
      point,
      x - 1u,
      fundamentalFrequencies[x - 1u],
      x,
      centerFrequency,
      26.0,
    );
  }
  var nextMask = 0.0;
  if (x + 1u < dimensions.x) {
    nextMask = segmentLineMask(
      point,
      x,
      centerFrequency,
      x + 1u,
      fundamentalFrequencies[x + 1u],
      26.0,
    );
  }
  let lineColor = mix(drawParams.primary.xyz, vec3f(0.0), 0.12);
  let color = mix(
    baseColor,
    lineColor,
    max(lineMask, max(previousMask, nextMask)),
  );
  return vec4f(color, 1.0);
}
