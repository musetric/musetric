import { centsDistanceWgsl } from '../common/centsDistance.wgsl.js';

export const fragmentShader = `
struct DrawParams {
  foreground : vec4f,
  background : vec4f,
  primary : vec4f,
  frequencyMap : vec4f,
  recordingMatchColor : vec4f,
  recordingCloseColor : vec4f,
  recordingMissColor : vec4f,
  recordingTimingMissColor : vec4f,
  recordingForeground : vec4f,
  comparisonThresholds : vec4f,
  lineWidths : vec4f,
  overlayTuning : vec4f,
  visibility : vec4u,
  noteVisibility : vec4u,
  ringSlots : vec4u,
};

@group(0) @binding(0) var<uniform> drawParams : DrawParams;
@group(0) @binding(1) var valueSampler : sampler;
@group(0) @binding(2) var spectrogramTextures : texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> referenceLine : array<f32>;
@group(0) @binding(4) var<storage, read> targetLine : array<f32>;
@group(0) @binding(5) var<storage, read> targetVerdicts : array<vec2f>;

fn midiAtFrequency(frequency: f32) -> f32 {
  return 69.0 + 12.0 * log2(frequency / 440.0);
}

fn frequencyAtPixel(pixelY: u32, height: f32) -> f32 {
  let ratio = 1.0 - f32(pixelY) / max(1.0, height - 1.0);
  return exp(drawParams.frequencyMap.x + drawParams.frequencyMap.y * ratio);
}

fn pixelYAtFrequency(frequency: f32, height: f32) -> f32 {
  let ratio = (log(frequency) - drawParams.frequencyMap.x) /
    drawParams.frequencyMap.y;
  return (1.0 - ratio) * max(1.0, height - 1.0);
}

${centsDistanceWgsl}

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
    centsDistance(startFrequency, endFrequency) > drawParams.overlayTuning.w
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

fn verdictColor(distance: f32) -> vec3f {
  let matchThreshold = max(drawParams.comparisonThresholds.x, 0.0);
  let closeThreshold = max(
    drawParams.comparisonThresholds.y,
    matchThreshold + 0.001,
  );
  let missThreshold = max(
    drawParams.comparisonThresholds.z,
    closeThreshold + 0.001,
  );
  let closeBlend = smoothstep(matchThreshold, closeThreshold, distance);
  let missBlend = smoothstep(closeThreshold, missThreshold, distance);
  let color = mix(
    drawParams.recordingMatchColor.xyz,
    drawParams.recordingCloseColor.xyz,
    closeBlend,
  );
  return mix(color, drawParams.recordingMissColor.xyz, missBlend);
}

fn targetTint(verdict: vec2f) -> vec3f {
  let pitchColor = verdictColor(verdict.x);
  return mix(
    pitchColor,
    drawParams.recordingTimingMissColor.xyz,
    clamp(verdict.y, 0.0, 1.0),
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
    exp(-0.5 * normalizedDistance * normalizedDistance) * drawParams.overlayTuning.z,
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

fn slotForScreenX(baseSlot: u32, screenX: u32, width: u32) -> u32 {
  return (baseSlot + screenX) % width;
}

fn sampleSpectrogram(slot: u32, y: u32, layer: u32, width: u32, height: u32) -> f32 {
  let sampleUv = vec2f(
    (f32(slot) + 0.5) / f32(width),
    (f32(y) + 0.5) / f32(height),
  );
  return textureSampleLevel(
    spectrogramTextures,
    valueSampler,
    sampleUv,
    layer,
    0.0,
  ).r;
}

@fragment
fn main(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = textureDimensions(spectrogramTextures);
  let width = dimensions.x;
  let height = f32(dimensions.y);
  let textureHeight = dimensions.y;
  let x = min(u32(position.x), width - 1u);
  let y = min(u32(position.y), textureHeight - 1u);
  let layer0Slot = slotForScreenX(drawParams.ringSlots.x, x, width);
  let layer1Slot = slotForScreenX(drawParams.ringSlots.y, x, width);
  let referenceSlot = slotForScreenX(drawParams.ringSlots.z, x, width);
  let targetSlot = slotForScreenX(drawParams.ringSlots.w, x, width);

  let referenceFrequency = referenceLine[referenceSlot];
  let targetFrequency = targetLine[targetSlot];
  let targetVerdict = targetVerdicts[targetSlot];

  let pixelFrequency = frequencyAtPixel(y, height);
  let pixelMidiRow = i32(floor(midiAtFrequency(pixelFrequency) + 0.5));

  var color = drawParams.background.xyz;
  if (drawParams.noteVisibility.x != 0u && pixelMidiRow % 2 == 0) {
    color = mix(color, drawParams.foreground.xyz, drawParams.overlayTuning.x);
  }
  if (drawParams.visibility.x != 0u) {
    let intensity = sampleSpectrogram(layer0Slot, y, 0u, width, textureHeight);
    color = min(color + drawParams.foreground.xyz * intensity, vec3f(1.0));
  }
  if (drawParams.visibility.y != 0u) {
    let intensity = sampleSpectrogram(layer1Slot, y, 1u, width, textureHeight);
    var tint = drawParams.recordingForeground.xyz;
    if (targetFrequency > 0.0) {
      tint = targetTint(targetVerdict);
    }
    color = mix(color, tint, clamp(intensity * drawParams.overlayTuning.y, 0.0, 1.0));
  }

  let referenceLineWidthCents = drawParams.lineWidths.y;
  let targetLineWidthCents = drawParams.lineWidths.x;

  var referenceMask = 0.0;
  let referenceVisible = drawParams.visibility.z != 0u;
  if (referenceVisible) {
    var referencePrev = 0.0;
    if (x > 0u) {
      referencePrev = referenceLine[
        slotForScreenX(drawParams.ringSlots.z, x - 1u, width)
      ];
    }
    var referenceNext = 0.0;
    if (x + 1u < width) {
      referenceNext = referenceLine[
        slotForScreenX(drawParams.ringSlots.z, x + 1u, width)
      ];
    }
    referenceMask = lineMaskAtPixel(
      position.xy,
      width,
      height,
      x,
      referenceFrequency,
      referencePrev,
      referenceNext,
      referenceLineWidthCents,
    );
  }

  var targetMask = 0.0;
  let targetVisible = drawParams.visibility.w != 0u;
  if (targetVisible) {
    var targetPrev = 0.0;
    if (x > 0u) {
      targetPrev = targetLine[
        slotForScreenX(drawParams.ringSlots.w, x - 1u, width)
      ];
    }
    var targetNext = 0.0;
    if (x + 1u < width) {
      targetNext = targetLine[
        slotForScreenX(drawParams.ringSlots.w, x + 1u, width)
      ];
    }
    targetMask = lineMaskAtPixel(
      position.xy,
      width,
      height,
      x,
      targetFrequency,
      targetPrev,
      targetNext,
      targetLineWidthCents,
    );
  }

  let referenceLineColor = vec3f(1.0);
  color = mix(color, referenceLineColor, referenceMask);
  var targetLineColor = drawParams.primary.xyz;
  if (targetFrequency > 0.0) {
    targetLineColor = targetTint(targetVerdict);
  }
  color = mix(color, targetLineColor, targetMask);

  return vec4f(color, 1.0);
}
`;
