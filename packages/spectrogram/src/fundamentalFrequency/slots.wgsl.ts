export const pitchSlotStruct = `struct PitchSlot {
  frame: i32,
  spanOffset: u32,
  predecessor: i32,
  observe: u32,
};`;

export const pitchObservationStruct = `struct PitchObservation {
  candidates: array<vec2<f32>, 5>,
  voicing: f32,
  frame: i32,
};`;

export const pitchDecodedStruct = `struct PitchDecoded {
  frequency: f32,
  confidence: f32,
  frame: i32,
  raw: f32,
};`;
