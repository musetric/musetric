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
  comparisonThresholds : vec4f,
  lineWidths : vec4f,
  overlayTuning : vec4f,
  laneLayout : vec4f,
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
    centsDistance(startFrequency, endFrequency) > drawParams.overlayTuning.z
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
    exp(-0.5 * normalizedDistance * normalizedDistance) * drawParams.overlayTuning.y,
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

fn segmentDistance(
  point: vec2f,
  height: f32,
  startIndex: u32,
  startFrequency: f32,
  endIndex: u32,
  endFrequency: f32,
) -> f32 {
  if (
    startFrequency <= 0.0 ||
    endFrequency <= 0.0 ||
    centsDistance(startFrequency, endFrequency) > drawParams.overlayTuning.z
  ) {
    return height;
  }

  let start = vec2f(
    f32(startIndex) + 0.5,
    pixelYAtFrequency(startFrequency, height) + 0.5,
  );
  let end = vec2f(
    f32(endIndex) + 0.5,
    pixelYAtFrequency(endFrequency, height) + 0.5,
  );
  return distanceToSegment(point, start, end);
}

fn lineDistanceAtPixel(
  point: vec2f,
  width: u32,
  height: f32,
  x: u32,
  centerFrequency: f32,
  previousFrequency: f32,
  nextFrequency: f32,
) -> f32 {
  if (centerFrequency <= 0.0) {
    return height;
  }

  var distance = abs(point.y - pixelYAtFrequency(centerFrequency, height) - 0.5);
  if (x > 0u && previousFrequency > 0.0) {
    distance = min(
      distance,
      segmentDistance(point, height, x - 1u, previousFrequency, x, centerFrequency),
    );
  }
  if (x + 1u < width && nextFrequency > 0.0) {
    distance = min(
      distance,
      segmentDistance(point, height, x, centerFrequency, x + 1u, nextFrequency),
    );
  }
  return distance;
}

fn cornerCoverage(point: vec2f, center: vec2f, radius: f32) -> f32 {
  return clamp(radius - distance(point, center) + 0.5, 0.0, 1.0);
}

fn bandCornerCoverage(point: vec2f, top: f32, bottom: f32, width: f32) -> f32 {
  let radius = drawParams.laneLayout.y;
  var centerY = 0.0;
  if (point.y < top + radius) {
    centerY = top + radius;
  } else if (point.y > bottom - radius) {
    centerY = bottom - radius;
  } else {
    return 1.0;
  }
  if (point.x < radius) {
    return cornerCoverage(point, vec2f(radius, centerY), radius);
  }
  if (point.x > width - radius) {
    return cornerCoverage(point, vec2f(width - radius, centerY), radius);
  }
  return 1.0;
}

fn stripeCoverage(distance: f32, halfWidth: f32) -> f32 {
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, distance);
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

fn sampleBandSpectrogram(
  slot: u32,
  bandY: u32,
  bandHeight: u32,
  layer: u32,
  width: u32,
  textureHeight: u32,
) -> f32 {
  let rowsPerPixel = f32(textureHeight - 1u) / f32(max(bandHeight, 2u) - 1u);
  let firstRow = min(
    u32(floor(f32(bandY) * rowsPerPixel + 0.5)),
    textureHeight - 1u,
  );
  let lastRow = clamp(
    u32(floor(f32(bandY + 1u) * rowsPerPixel + 0.5)),
    firstRow + 1u,
    textureHeight,
  );
  var value = 0.0;
  for (var row = firstRow; row < lastRow; row += 1u) {
    value = max(value, sampleSpectrogram(slot, row, layer, width, textureHeight));
  }
  return value;
}

@fragment
fn main(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = textureDimensions(spectrogramTextures);
  let width = dimensions.x;
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

  let stacked = drawParams.visibility.x != 0u && drawParams.visibility.y != 0u;
  let laneGap = min(u32(drawParams.laneLayout.x), textureHeight);
  let splitRow = select(textureHeight, (textureHeight - laneGap) / 2u, stacked);
  let gapEnd = select(textureHeight, splitRow + laneGap, stacked);
  if (y >= splitRow && y < gapEnd) {
    return vec4f(0.0);
  }
  let recordingBand = stacked && y < splitRow;
  let lowerBand = stacked && !recordingBand;
  let bandTop = select(0u, gapEnd, lowerBand);
  let bandHeight = select(splitRow, textureHeight - gapEnd, lowerBand);
  let bandY = y - bandTop;

  let pixelFrequency = frequencyAtPixel(bandY, f32(bandHeight));
  let pixelMidiRow = i32(floor(midiAtFrequency(pixelFrequency) + 0.5));

  var color = drawParams.background.xyz;
  if (drawParams.noteVisibility.x != 0u && pixelMidiRow % 2 == 0) {
    color = mix(color, drawParams.foreground.xyz, drawParams.overlayTuning.x);
  }
  let recordingShown = recordingBand || drawParams.visibility.x == 0u;
  let laneVisible = select(
    drawParams.visibility.x,
    drawParams.visibility.y,
    recordingShown,
  );
  if (laneVisible != 0u) {
    let intensity = sampleBandSpectrogram(
      select(layer0Slot, layer1Slot, recordingShown),
      bandY,
      bandHeight,
      select(0u, 1u, recordingShown),
      width,
      textureHeight,
    );
    color = min(color + drawParams.foreground.xyz * intensity, vec3f(1.0));
  }

  let referenceLineWidthCents = drawParams.lineWidths.y;
  let targetLineWidthCents = drawParams.lineWidths.x;
  let bandPoint = vec2f(position.x, position.y - f32(bandTop));
  let bandPixelHeight = f32(bandHeight);

  var referenceMask = 0.0;
  let referenceVisible = !recordingBand && drawParams.visibility.z != 0u;
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
      bandPoint,
      width,
      bandPixelHeight,
      x,
      referenceFrequency,
      referencePrev,
      referenceNext,
      referenceLineWidthCents,
    );
  }

  var targetMask = 0.0;
  var targetOutlineMask = 0.0;
  let targetVisible = !recordingBand && drawParams.visibility.w != 0u;
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
    if (stacked) {
      let distance = lineDistanceAtPixel(
        bandPoint,
        width,
        bandPixelHeight,
        x,
        targetFrequency,
        targetPrev,
        targetNext,
      );
      let halfWidth = 0.5 * drawParams.lineWidths.z;
      targetMask = stripeCoverage(distance, halfWidth);
      targetOutlineMask = stripeCoverage(
        distance,
        halfWidth + drawParams.lineWidths.w,
      );
    } else {
      targetMask = lineMaskAtPixel(
        bandPoint,
        width,
        bandPixelHeight,
        x,
        targetFrequency,
        targetPrev,
        targetNext,
        targetLineWidthCents,
      );
    }
  }

  let referenceLineColor = vec3f(1.0);
  color = mix(color, referenceLineColor, referenceMask);
  color = mix(color, drawParams.background.xyz, targetOutlineMask);
  var targetLineColor = drawParams.primary.xyz;
  if (targetFrequency > 0.0) {
    targetLineColor = targetTint(targetVerdict);
  }
  color = mix(color, targetLineColor, targetMask);

  let coverage = bandCornerCoverage(
    position.xy,
    f32(bandTop),
    f32(bandTop + bandHeight),
    f32(width),
  );
  return vec4f(color * coverage, coverage);
}
`;
