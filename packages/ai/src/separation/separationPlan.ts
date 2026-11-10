const stepSeconds = 8;

export type SeparationGeometry = {
  sampleRate: number;
  chunkSamples: number;
};

export const separationStep = (geometry: SeparationGeometry): number =>
  Math.min(stepSeconds * geometry.sampleRate, geometry.chunkSamples);

export type SeparationUnit = {
  start: number;
  length: number;
};

export const planSeparation = (
  geometry: SeparationGeometry,
  frames: number,
): SeparationUnit[] => {
  const { chunkSamples } = geometry;
  const step = separationStep(geometry);
  const units: SeparationUnit[] = [];
  for (let offset = 0; offset < frames; offset += step) {
    if (offset + chunkSamples <= frames) {
      units.push({ start: offset, length: chunkSamples });
    } else if (frames >= chunkSamples) {
      units.push({ start: frames - chunkSamples, length: chunkSamples });
    } else {
      units.push({ start: 0, length: frames });
    }
  }
  return units;
};

export const settledFrames = (
  units: SeparationUnit[],
  next: number,
  frames: number,
): number => Math.min(frames, ...units.slice(next).map((unit) => unit.start));

export const reachedFrames = (
  units: SeparationUnit[],
  next: number,
  frames: number,
): number =>
  Math.min(
    frames,
    Math.max(
      0,
      ...units.slice(0, next).map((unit) => unit.start + unit.length),
    ),
  );
